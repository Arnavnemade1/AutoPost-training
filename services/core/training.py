"""Real Qwen LoRA optimization and deterministic, sample-level evaluation."""

import gc
import hashlib
import json
import random
import time
from decimal import Decimal, InvalidOperation
from pathlib import Path
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import LoraConfig, PeftModel, get_peft_model
from datasets import load_dataset
from huggingface_hub import hf_hub_download
from forge_training.config import Example
from forge_training.artifacts import file_sha256
from forge_training.data import verify_separation
from forge_training.modeling import prompt_for
from forge_training.scoring import extract_answer, wilson_interval
from forge_training.training import encode_completion, collate_completion
from services.core.contracts import MODEL_ID, MODEL_REVISION

DATASET_REVISION = "740312add88f781978c0658806c59bc2815b9866"
PROMPT_VERSION = "math_completion_v1"


def sha(path):
    return file_sha256(Path(path))


def extract(text):
    value = extract_answer(text)
    return str(value) if value is not None else ""


def equal(a, b):
    try:
        return Decimal(a) == Decimal(b)
    except InvalidOperation:
        return False


def benchmark_data(config):
    # Training and dev are disjoint slices of the official train split. Test stays sealed.
    path = hf_hub_download(
        "openai/gsm8k",
        repo_type="dataset",
        revision=DATASET_REVISION,
        filename="main/train-00000-of-00001.parquet",
    )
    ds = load_dataset("parquet", data_files={"train": path}, split="train")
    ids = list(range(len(ds)))
    random.Random(config["seed"]).shuffle(ids)
    dev_ids = ids[: config["dev_samples"]]
    train_ids = ids[config["dev_samples"] : config["dev_samples"] + 384]
    train = [dict(ds[i]) | {"id": f"train-{i}"} for i in train_ids]
    dev = [dict(ds[i]) | {"id": f"train-{i}"} for i in dev_ids]
    verify_separation([Example(**r) for r in train], [Example(**r) for r in dev])

    # Only the final evaluator calls this closure after checkpoint selection is frozen.
    def sealed():
        from services.core import store

        path = hf_hub_download(
            "openai/gsm8k",
            repo_type="dataset",
            revision=DATASET_REVISION,
            filename="main/test-00000-of-00001.parquet",
        )
        test = load_dataset("parquet", data_files={"sealed": path}, split="sealed")
        exposed = {
            p["id"]
            for s in store.campaigns()
            for p in s.get("final", {}).get("baseline", {}).get("predictions", [])
        }
        exposed.update(p for campaign in store.campaigns() for p in campaign.get("sealed_ids", []))
        available = [i for i in range(len(test)) if f"test-{i}" not in exposed]
        if len(available) < config["final_samples"]:
            raise ValueError("Insufficient unqueried final examples; refuse test-set reuse")
        rng = random.Random(config["seed"] + 1)
        chosen = rng.sample(available, config["final_samples"])
        return [dict(test[i]) | {"id": f"test-{i}"} for i in chosen]

    return train, dev, sealed


def device_name():
    return "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"


def load(adapter=None):
    device = device_name()
    dtype = torch.float32 if device == "cpu" else torch.float16
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID, revision=MODEL_REVISION, dtype=dtype, attn_implementation="eager"
    )
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, revision=MODEL_REVISION)
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "left"
    if adapter:
        model = PeftModel.from_pretrained(model, str(adapter))
    return model.to(device), tokenizer


def unload(model):
    model.to("cpu")
    del model
    gc.collect()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()


def evaluate(model, tokenizer, rows, progress, cancelled, split="development", worlds=None):
    model.eval()
    predictions = []
    started = time.monotonic()
    with torch.inference_mode():
        for i, row in enumerate(rows):
            if cancelled():
                raise InterruptedError("Campaign stopped")
            text = prompt_for(tokenizer, row["question"])
            inputs = tokenizer(text, return_tensors="pt").to(model.device)
            tokens = model.generate(
                **inputs, do_sample=False, max_new_tokens=256, pad_token_id=tokenizer.eos_token_id
            )
            generated = tokens[0, inputs["input_ids"].shape[1] :]
            output = tokenizer.decode(generated, skip_special_tokens=True)
            truncated = len(generated) >= 256 and generated[-1].item() != tokenizer.eos_token_id
            answer, expected = extract(output), extract(row["answer"])
            correct = equal(answer, expected)
            env = worlds(row, answer, i) if worlds else None
            if env is not None:
                correct = env["reward"] == 1
            p = {
                "id": row["id"],
                "question": row["question"],
                "output": output,
                "answer": answer,
                "expected": expected,
                "correct": correct,
                "finish_reason": "length" if truncated else "stop",
                "environment_id": env["id"] if env else None,
            }
            predictions.append(p)
            progress(i + 1, len(rows), p)
    n = len(predictions)
    score = sum(p["correct"] for p in predictions) / n if n else 0
    # Wilson interval for the subset. No claim of statistical significance.
    interval = wilson_interval(sum(p["correct"] for p in predictions), n)
    return {
        "score": score,
        "n": n,
        "correct": sum(p["correct"] for p in predictions),
        "ci95": interval,
        "predictions": predictions,
        "split": split,
        "benchmark": "GSM8K subset",
        "dataset_revision": DATASET_REVISION,
        "scoring": "forge_numeric_v1, strict final #### numeric line (shared training-core scorer)",
        "prompt_version": PROMPT_VERSION,
        "decoding": {"do_sample": False, "max_new_tokens": 256},
        "seconds": time.monotonic() - started,
        "model_revision": MODEL_REVISION,
    }


def train(proposal, config, rows, folder, progress, cancelled):
    torch.manual_seed(config["seed"])
    random.seed(config["seed"])
    model, tokenizer = load()
    model = get_peft_model(
        model,
        LoraConfig(
            r=proposal["lora_rank"],
            lora_alpha=proposal["lora_rank"] * 2,
            lora_dropout=0.05,
            target_modules=["q_proj", "v_proj"],
            task_type="CAUSAL_LM",
        ),
    )
    params = [p for p in model.parameters() if p.requires_grad]
    before = hashlib.sha256(b"".join(p.detach().float().cpu().numpy().tobytes() for p in params)).hexdigest()
    optimizer = torch.optim.AdamW(params, lr=proposal["learning_rate"])
    model.train()
    model.config.use_cache = False
    metrics = []
    sampled = list(rows)
    production = [r for r in sampled if r["id"].startswith("prod-")]
    sampled = [r for r in sampled if not r["id"].startswith("prod-")]
    if proposal["strategy"] == "targeted_sft":
        # Reweight longer, multi-step worked solutions using training data only.
        sampled.sort(key=lambda r: len(r["answer"]), reverse=True)
        sampled = sampled[: max(32, len(sampled) // 2)]
    random.Random(config["seed"]).shuffle(sampled)
    random.Random(config["seed"]).shuffle(production)
    # Each step trains one record, so targeted runs see production failures first.
    if proposal["strategy"] == "targeted_sft":
        sampled = production + sampled
    else:
        sampled = sampled + production
        random.Random(config["seed"]).shuffle(sampled)
    records = []
    accepted = []
    excluded = []
    for row in sampled:
        try:
            records.append(encode_completion(tokenizer, Example(**row), 768))
            accepted.append(row)
        except ValueError:
            excluded.append(row["id"])
    if not records:
        raise ValueError("No complete training examples fit the sequence limit")
    started = time.monotonic()
    for step in range(config["train_steps"]):
        if cancelled():
            raise InterruptedError("Campaign stopped")
        record = records[step % len(records)]
        batch = collate_completion([record], tokenizer.pad_token_id, str(model.device))
        optimizer.zero_grad(set_to_none=True)
        loss = model(**batch).loss
        if not torch.isfinite(loss):
            raise RuntimeError("Nonfinite training loss; experiment quarantined")
        loss.backward()
        torch.nn.utils.clip_grad_norm_(params, 1.0, error_if_nonfinite=True)
        optimizer.step()
        metric = {
            "step": step + 1,
            "loss": round(loss.item(), 5),
            "elapsed": round(time.monotonic() - started, 2),
            "learning_rate": proposal["learning_rate"],
        }
        metrics.append(metric)
        progress(metric)
    after = hashlib.sha256(b"".join(p.detach().float().cpu().numpy().tobytes() for p in params)).hexdigest()
    folder.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(folder)
    tokenizer.save_pretrained(folder)
    (folder / "training.json").write_text(
        json.dumps(
            {
                "proposal": proposal,
                "config": config,
                "metrics": metrics,
                "before_hash": before,
                "after_hash": after,
                "weights_changed": before != after,
                "train_ids": [r["id"] for r in accepted],
                "excluded_oversize_ids": excluded,
                "max_sequence_length": 768,
                "prompt_version": PROMPT_VERSION,
                "model_revision": MODEL_REVISION,
            },
            indent=2,
        )
    )
    del optimizer, params
    unload(model)
    return {
        "metrics": metrics,
        "before_hash": before,
        "after_hash": after,
        "weights_changed": before != after,
        "sha256": sha(folder / "adapter_model.safetensors"),
        "seconds": time.monotonic() - started,
        "max_sequence_length": 768,
    }
