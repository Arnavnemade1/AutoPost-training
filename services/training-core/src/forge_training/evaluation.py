"""Independent checkpoint loading, sample-level predictions, and paired comparisons."""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

from .artifacts import directory_sha256, runtime_versions, utc_now
from .config import ExperimentConfig
from .data import load_dataset
from .modeling import PROMPT_INSTRUCTION, PROMPT_VERSION, load_base, prompt_for, seed_everything
from .reports import EvaluationReport
from .scoring import SCORER_VERSION, extract_answer, paired_bootstrap, score, wilson_interval


def evaluation_protocol(config: ExperimentConfig) -> dict:
    return {
        "evaluation": config.evaluation.model_dump(),
        "seed": config.seed,
        "device": config.device,
        "precision": config.precision,
        "prompt_version": PROMPT_VERSION,
        "instruction": PROMPT_INSTRUCTION,
        "do_sample": False,
        "num_beams": 1,
        "runtime": runtime_versions(),
    }


def evaluate(
    config: ExperimentConfig, checkpoint: Path | None = None, expected_hash: str | None = None
):
    import torch
    from peft import PeftModel
    from transformers import MaxTimeCriteria, StoppingCriteriaList

    started = time.monotonic()
    timestamp = utc_now()
    protocol = evaluation_protocol(config)
    rows, manifest = load_dataset(config.development, "development")
    for row in rows:
        if extract_answer(row.answer) is None:
            raise ValueError(f"Invalid development reference: {row.id}")
    checkpoint_hash = None
    if checkpoint is not None:
        checkpoint_hash = directory_sha256(checkpoint)
        if expected_hash is None or checkpoint_hash != expected_hash:
            raise ValueError("Checkpoint checksum mismatch or missing expected checksum")
        adapter_config = json.loads((checkpoint / "adapter_config.json").read_text())
        if adapter_config.get("base_model_name_or_path") != config.model.model_id:
            raise ValueError("Adapter belongs to a different base model")
        if adapter_config.get("revision") != config.model.revision:
            raise ValueError("Adapter base revision mismatch")
    seed_everything(config.seed)
    model, tokenizer = load_base(config)
    if checkpoint is not None:
        model = PeftModel.from_pretrained(model, str(checkpoint), is_trainable=False)
    model.eval()
    samples = []
    for row in rows:
        remaining = config.evaluation.max_seconds - (time.monotonic() - started)
        if remaining <= 0:
            raise TimeoutError(
                "Development evaluation time limit reached; no partial score emitted"
            )
        prompt = prompt_for(tokenizer, row.question)
        inputs = tokenizer(prompt, return_tensors="pt", add_special_tokens=False)
        prompt_length = inputs["input_ids"].shape[-1]
        if prompt_length > config.evaluation.max_prompt_tokens:
            raise ValueError(f"Development prompt exceeds token limit (no truncation): {row.id}")
        context_limit = getattr(model.config, "max_position_embeddings", None)
        if context_limit and prompt_length + config.evaluation.max_new_tokens > context_limit:
            raise ValueError(f"Evaluation would exceed model context window: {row.id}")
        inputs = {name: tensor.to(config.device) for name, tensor in inputs.items()}
        with torch.inference_mode():
            generated = model.generate(
                **inputs,
                do_sample=False,
                num_beams=1,
                max_new_tokens=config.evaluation.max_new_tokens,
                pad_token_id=tokenizer.pad_token_id,
                eos_token_id=tokenizer.eos_token_id,
                stopping_criteria=StoppingCriteriaList([MaxTimeCriteria(max_time=remaining)]),
            )
        if time.monotonic() - started > config.evaluation.max_seconds:
            raise TimeoutError("Evaluation deadline expired; incomplete generation is not scored")
        output = generated[0, prompt_length:]
        prediction = tokenizer.decode(output, skip_special_tokens=True)
        correct, diagnosis = score(prediction, row.answer)
        samples.append(
            {
                "id": row.id,
                "question": row.question,
                "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
                "reference_answer": str(extract_answer(row.answer)),
                "prediction": prediction,
                "correct": correct,
                "diagnosis": diagnosis,
                "generated_tokens": len(output),
                "hit_generation_limit": len(output) == config.evaluation.max_new_tokens,
            }
        )
    count = len(samples)
    correct = sum(sample["correct"] for sample in samples)
    if evaluation_protocol(config) != protocol:
        raise ValueError("Worker source or runtime changed during evaluation")
    report = {
        "schema_version": 1,
        "campaign_id": config.campaign_id,
        "experiment_id": config.experiment_id,
        "started_at": timestamp,
        "completed_at": utc_now(),
        "evaluation_role": "development",
        "benchmark_claim": "custom development diagnostic; not an official GSM8K score",
        "model": config.model.model_dump(),
        "checkpoint_sha256": checkpoint_hash,
        "dataset": manifest.model_dump(),
        "protocol": protocol,
        "scorer": SCORER_VERSION,
        "num_examples": count,
        "num_correct": correct,
        "accuracy": correct / count,
        "accuracy_wilson_95": wilson_interval(correct, count),
        "elapsed_seconds": time.monotonic() - started,
        "samples": samples,
    }
    return EvaluationReport.model_validate(report).model_dump()


def compare(baseline: dict, candidate: dict, seed: int) -> dict:
    baseline = EvaluationReport.model_validate(baseline).model_dump()
    candidate = EvaluationReport.model_validate(candidate).model_dump()
    for key in ("campaign_id", "experiment_id", "dataset", "protocol", "scorer", "model"):
        if baseline[key] != candidate[key]:
            raise ValueError(f"Cannot compare evaluations with different {key}")
    if baseline["checkpoint_sha256"] is not None or candidate["checkpoint_sha256"] is None:
        raise ValueError("Comparison requires the original baseline and a saved candidate")
    if (
        baseline["evaluation_role"] != "development"
        or candidate["evaluation_role"] != "development"
    ):
        raise ValueError("Research comparisons may only use development results")
    if len(baseline["samples"]) != len(candidate["samples"]) or not baseline["samples"]:
        raise ValueError("Evaluation sample counts differ or are empty")
    differences = []
    for before, after in zip(baseline["samples"], candidate["samples"], strict=True):
        for key in ("id", "question", "prompt_sha256", "reference_answer"):
            if before[key] != after[key]:
                raise ValueError(f"Evaluation examples differ: {key}")
        differences.append(int(after["correct"]) - int(before["correct"]))
    baseline_accuracy = sum(bool(row["correct"]) for row in baseline["samples"]) / len(differences)
    candidate_accuracy = sum(bool(row["correct"]) for row in candidate["samples"]) / len(
        differences
    )
    interval = paired_bootstrap(differences, seed)
    delta = (candidate_accuracy - baseline_accuracy) * 100
    return {
        "evaluation_role": "development",
        "num_examples": len(differences),
        "baseline_accuracy": baseline_accuracy,
        "candidate_accuracy": candidate_accuracy,
        "absolute_improvement_percentage_points": delta,
        "paired_bootstrap_95_percentage_points": interval,
        "improved_examples": differences.count(1),
        "regressed_examples": differences.count(-1),
        "improvement_observed": delta > 0,
        "checkpoint_promotion": "not_authorized_by_training_worker",
        "limitations": [
            "Development diagnostics cannot establish sealed final benchmark performance.",
            "Small samples and degenerate bootstrap intervals can understate uncertainty.",
            "Improvement on a target dataset does not establish general model superiority.",
            "Model pretraining contamination has not been excluded.",
            "No secondary capability or safety regression suite has run in this worker.",
        ],
    }
