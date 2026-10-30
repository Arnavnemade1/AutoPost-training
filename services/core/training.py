"""Real Qwen LoRA optimization and deterministic, sample-level evaluation."""

import functools
import gc
import hashlib
import json
import random
import time
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import LoraConfig, PeftModel, get_peft_model
from datasets import load_dataset
from huggingface_hub import hf_hub_download
from forge_training.config import Example
from forge_training.data import verify_separation
from forge_training.modeling import prompt_for
from forge_training.training import encode_completion, collate_completion
from services.core.contracts import MODEL_ID, MODEL_REVISION, model_spec  # noqa: F401
from services.core.protocol import (  # noqa: F401  (re-exported for the runner)
    DATASET_REVISION,
    PROMPT_VERSION,
    collect,
    equal,
    extract,
    sha,
)


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


def device_info():
    """Provenance for the hardware that actually ran a job, recorded with every result."""
    import os
    import platform
    import subprocess

    kind = device_name()
    if kind == "cuda":
        name = torch.cuda.get_device_name(0)
    elif kind == "mps":
        try:
            name = subprocess.run(
                ["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True, timeout=2
            ).stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            name = ""
        name = (name or "Apple silicon") + " / Metal"
    else:
        name = platform.processor() or platform.machine() or "CPU"
    return {
        "backend": os.environ.get("FORGE_EXECUTION_BACKEND", "local"),
        "type": kind,
        "name": name,
        "torch": torch.__version__,
        "cuda": torch.version.cuda if kind == "cuda" else None,
    }


def load(adapter=None, model_id=None):
    spec = model_spec(model_id)
    device = device_name()
    dtype = torch.float32 if device == "cpu" else getattr(torch, spec["dtype"])
    model = AutoModelForCausalLM.from_pretrained(
        spec["id"], revision=spec["revision"], dtype=dtype, attn_implementation="eager"
    )
    tokenizer = AutoTokenizer.from_pretrained(spec["id"], revision=spec["revision"])
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "left"
    if spec["chat_template_kwargs"]:
        # Every prompt, for evaluation and for training targets, renders with the same template
        # settings (Qwen3.5: non-thinking mode).
        tokenizer.apply_chat_template = functools.partial(
            tokenizer.apply_chat_template, **spec["chat_template_kwargs"]
        )
    if adapter:
        model = PeftModel.from_pretrained(model, str(adapter))
    model.forge_model_id = spec["id"]
    return model.to(device), tokenizer


def unload(model):
    model.to("cpu")
    del model
    gc.collect()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def predict(model, tokenizer, rows):
    """Greedy answers for a batch of rows. With one row this is exactly the original protocol."""
    texts = [prompt_for(tokenizer, row["question"]) for row in rows]
    inputs = tokenizer(texts, return_tensors="pt", padding=True).to(model.device)
    limit = model_spec(getattr(model, "forge_model_id", None))["max_new_tokens"]
    tokens = model.generate(
        **inputs, do_sample=False, max_new_tokens=limit, pad_token_id=tokenizer.eos_token_id
    )
    stops = {tokenizer.eos_token_id}
    configured = getattr(model.generation_config, "eos_token_id", None)
    stops.update(
        configured if isinstance(configured, list) else [configured] if configured is not None else []
    )
    width = inputs["input_ids"].shape[1]
    predictions = []
    for row, generated in zip(rows, tokens[:, width:].tolist(), strict=True):
        end = next((i for i, token in enumerate(generated) if token in stops), None)
        if end is not None:
            generated = generated[: end + 1]
        output = tokenizer.decode(generated, skip_special_tokens=True)
        answer, expected = extract(output), extract(row["answer"])
        predictions.append(
            {
                "id": row["id"],
                "question": row["question"],
                "output": output,
                "answer": answer,
                "expected": expected,
                "correct": equal(answer, expected),
                "finish_reason": "stop" if end is not None else "length",
            }
        )
    return predictions


def generate(model, tokenizer, rows, cancelled, batch_size=1):
    model.eval()
    with torch.inference_mode():
        for start in range(0, len(rows), batch_size):
            if cancelled():
                raise InterruptedError("Campaign stopped")
            yield from predict(model, tokenizer, rows[start : start + batch_size])


def evaluate(model, tokenizer, rows, progress, cancelled, split="development", worlds=None, batch_size=1):
    started = time.monotonic()
    stream = generate(model, tokenizer, rows, cancelled, batch_size)
    model_id = getattr(model, "forge_model_id", None)
    return collect(
        rows, stream, progress, split, worlds, started, device_info(), batch_size, model_id=model_id
    )


def train(proposal, config, rows, folder, progress, cancelled):
    torch.manual_seed(config["seed"])
    random.seed(config["seed"])
    device = device_info()
    spec = model_spec(config.get("model_id"))
    model, tokenizer = load(model_id=spec["id"])
    model = get_peft_model(
        model,
        LoraConfig(
            r=proposal["lora_rank"],
            lora_alpha=proposal["lora_rank"] * 2,
            lora_dropout=0.05,
            target_modules=spec["lora_targets"],
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
                "model_id": spec["id"],
                "model_revision": spec["revision"],
                "lora_targets": spec["lora_targets"],
                "device": device,
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
        "lora_targets": spec["lora_targets"],
        "dtype": spec["dtype"],
        "device": device,
    }
