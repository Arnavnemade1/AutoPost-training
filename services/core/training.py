"""Real Qwen LoRA optimization and deterministic, sample-level evaluation."""
import gc
import hashlib
import json
import random
import re
import time
from decimal import Decimal, InvalidOperation
from pathlib import Path
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import LoraConfig, PeftModel, get_peft_model
from datasets import load_dataset
from services.core.contracts import MODEL_ID, MODEL_REVISION

DATASET_REVISION = "740312add88f781978c0658806c59bc2815b9866"
PROMPT_VERSION = "forge-gsm8k-zero-shot-v1"
SYSTEM = "Solve the math problem. Show concise reasoning and end with #### followed by the numeric answer."


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1048576), b""):
            h.update(block)
    return h.hexdigest()


def extract(text):
    matches = re.findall(r"####\s*(-?\d[\d,]*(?:\.\d+)?)", text)
    if matches:
        return matches[-1].replace(",", "")
    # Disclosed lenient final-number fallback, identical for baseline and adapters.
    matches = re.findall(r"-?\d[\d,]*(?:\.\d+)?", text)
    return matches[-1].replace(",", "") if matches else ""


def equal(a, b):
    try:
        return Decimal(a) == Decimal(b)
    except InvalidOperation:
        return False


def benchmark_data(config):
    # Training and dev are disjoint slices of the official train split. Test stays sealed.
    ds = load_dataset("openai/gsm8k", "main", revision=DATASET_REVISION)
    ids = list(range(len(ds["train"])))
    random.Random(config["seed"]).shuffle(ids)
    dev_ids = ids[:config["dev_samples"]]
    train_ids = ids[config["dev_samples"]:config["dev_samples"] + 384]
    train = [dict(ds["train"][i]) | {"id": f"train-{i}"} for i in train_ids]
    dev = [dict(ds["train"][i]) | {"id": f"train-{i}"} for i in dev_ids]
    # Only the final evaluator calls this closure after checkpoint selection is frozen.
    def sealed():
        rng = random.Random(config["seed"] + 1)
        chosen = rng.sample(range(len(ds["test"])), config["final_samples"])
        return [dict(ds["test"][i]) | {"id": f"test-{i}"} for i in chosen]
    return train, dev, sealed


def device_name():
    return "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"


def load(adapter=None):
    device = device_name()
    dtype = torch.float32 if device == "cpu" else torch.float16
    model = AutoModelForCausalLM.from_pretrained(MODEL_ID, revision=MODEL_REVISION, dtype=dtype, attn_implementation="eager")
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
            text = tokenizer.apply_chat_template([{"role": "system", "content": SYSTEM}, {"role": "user", "content": row["question"]}], tokenize=False, add_generation_prompt=True)
            inputs = tokenizer(text, return_tensors="pt").to(model.device)
            tokens = model.generate(**inputs, do_sample=False, max_new_tokens=192, pad_token_id=tokenizer.eos_token_id)
            output = tokenizer.decode(tokens[0, inputs["input_ids"].shape[1]:], skip_special_tokens=True)
            answer, expected = extract(output), extract(row["answer"])
            correct = equal(answer, expected)
            env = worlds(row, answer, i) if worlds else None
            if env is not None:
                correct = env["reward"] == 1
            p = {"id": row["id"], "question": row["question"], "output": output, "answer": answer,
                 "expected": expected, "correct": correct, "environment_id": env["id"] if env else None}
            predictions.append(p)
            progress(i + 1, len(rows), p)
    n = len(predictions)
    score = sum(p["correct"] for p in predictions) / n if n else 0
    # Wilson interval for the subset. No claim of statistical significance.
    z, denom = 1.96, 1 + 1.96**2 / n
    center = (score + z*z/(2*n)) / denom
    half = z * ((score*(1-score)/n + z*z/(4*n*n)) ** .5) / denom
    return {"score": score, "n": n, "correct": sum(p["correct"] for p in predictions), "ci95": [max(0, center-half), min(1, center+half)],
        "predictions": predictions, "split": split, "benchmark": "GSM8K subset", "dataset_revision": DATASET_REVISION,
        "scoring": "forge numeric exact match v1, #### extraction with final-number fallback",
        "prompt_version": PROMPT_VERSION, "decoding": {"do_sample": False, "max_new_tokens": 192},
        "seconds": time.monotonic()-started, "model_revision": MODEL_REVISION}


def train(proposal, config, rows, folder, progress, cancelled):
    torch.manual_seed(config["seed"])
    random.seed(config["seed"])
    model, tokenizer = load()
    model = get_peft_model(model, LoraConfig(r=proposal["lora_rank"], lora_alpha=proposal["lora_rank"]*2,
        lora_dropout=0.05, target_modules=["q_proj", "v_proj"], task_type="CAUSAL_LM"))
    params = [p for p in model.parameters() if p.requires_grad]
    before = hashlib.sha256(b"".join(p.detach().float().cpu().numpy().tobytes() for p in params)).hexdigest()
    optimizer = torch.optim.AdamW(params, lr=proposal["learning_rate"])
    model.train()
    model.config.use_cache = False
    metrics = []
    sampled = list(rows)
    if proposal["strategy"] == "targeted_sft":
        # Reweight longer, multi-step worked solutions using training data only.
        sampled.sort(key=lambda r: len(r["answer"]), reverse=True)
        sampled = sampled[:max(32, len(sampled)//2)]
    random.Random(config["seed"]).shuffle(sampled)
    started = time.monotonic()
    for step in range(config["train_steps"]):
        if cancelled():
            raise InterruptedError("Campaign stopped")
        row = sampled[step % len(sampled)]
        messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": row["question"]}]
        prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        full = tokenizer.apply_chat_template(messages + [{"role": "assistant", "content": row["answer"]}], tokenize=False)
        batch = tokenizer(full, return_tensors="pt", truncation=True, max_length=384).to(model.device)
        labels = batch["input_ids"].clone()
        prefix_length = len(tokenizer(prompt)["input_ids"])
        labels[:, :prefix_length] = -100
        if (labels != -100).sum().item() == 0:
            continue
        optimizer.zero_grad(set_to_none=True)
        loss = model(**batch, labels=labels).loss
        if not torch.isfinite(loss):
            raise RuntimeError("Nonfinite training loss; experiment quarantined")
        loss.backward()
        torch.nn.utils.clip_grad_norm_(params, 1.0)
        optimizer.step()
        metric = {"step": step+1, "loss": round(loss.item(), 5), "elapsed": round(time.monotonic()-started, 2), "learning_rate": proposal["learning_rate"]}
        metrics.append(metric)
        progress(metric)
    after = hashlib.sha256(b"".join(p.detach().float().cpu().numpy().tobytes() for p in params)).hexdigest()
    folder.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(folder)
    tokenizer.save_pretrained(folder)
    (folder / "training.json").write_text(json.dumps({"proposal": proposal, "config": config, "metrics": metrics,
        "before_hash": before, "after_hash": after, "weights_changed": before != after,
        "train_ids": [r["id"] for r in sampled], "model_revision": MODEL_REVISION}, indent=2))
    del optimizer, params
    unload(model)
    return {"metrics": metrics, "before_hash": before, "after_hash": after, "weights_changed": before != after,
            "sha256": sha(folder / "adapter_model.safetensors"), "seconds": time.monotonic()-started}
