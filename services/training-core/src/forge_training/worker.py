"""Bounded subprocess orchestration; no campaign budgets or promotion permissions."""

from __future__ import annotations

import json
import os
import platform
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

from .artifacts import (
    EventLog,
    directory_manifest,
    file_sha256,
    manifest_sha256,
    runtime_versions,
    utc_now,
    write_json,
)
from .config import ExperimentConfig, load_config
from .data import load_dataset, verify_separation
from .evaluation import compare
from .scoring import extract_answer


def validate_inputs(config: ExperimentConfig, *, check_output: bool = True) -> dict:
    train, train_manifest = load_dataset(config.train, "train")
    development, dev_manifest = load_dataset(config.development, "development")
    verify_separation(train, development)
    if any(extract_answer(row.answer) is None for row in train + development):
        raise ValueError("All references must end with a numeric '#### <answer>' line")
    output = Path(config.output_dir)
    inputs = [
        Path(spec_path)
        for spec in (config.train, config.development)
        for spec_path in (spec.records, spec.manifest)
    ]
    if config.model.source == "local":
        inputs.append(Path(config.model.model_id))
        if output.is_relative_to(Path(config.model.model_id)):
            raise ValueError("Output may not be written inside the local base-model directory")
    if check_output and any(input_path.is_relative_to(output) for input_path in inputs):
        raise ValueError("Output directory may not contain input artifacts")
    return {"train": train_manifest.model_dump(), "development": dev_manifest.model_dump()}


def run_phase(arguments: list[str], timeout: int, log: Path) -> None:
    """A parent deadline terminates a whole process group, including model loading."""
    with log.open("x", encoding="utf-8") as stream:
        process = subprocess.Popen(
            [sys.executable, "-m", "forge_training", *arguments],
            stdout=stream,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            code = process.wait(timeout=timeout)
        except BaseException:
            # Also cancel the child on Ctrl-C or termination of the calling operation.
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            raise
    if code:
        raise RuntimeError(f"Worker subprocess failed (exit {code}); inspect {log}")


def run_experiment(config_path: Path) -> dict:
    config = load_config(config_path)
    datasets = validate_inputs(config)
    output = Path(config.output_dir)
    # Creation is the claim on a run directory; another worker cannot reuse it.
    output.mkdir(parents=True, exist_ok=False)
    events = EventLog(output / "events.jsonl", config.campaign_id, config.experiment_id)
    started = time.monotonic()
    try:
        runtime = runtime_versions()
        write_json(
            output / "environment.json",
            {
                "python": sys.version,
                "platform": platform.platform(),
                "runtime": runtime,
            },
        )
        # Freeze exact input bytes before separate processes read them. Source files
        # may be owned by another agent and must not change the effective experiment.
        staged = output / "inputs"
        staged.mkdir()
        effective = config.model_dump()
        replay = config.model_dump()
        for purpose in ("train", "development"):
            source = getattr(config, purpose)
            for key, suffix in (("records", "jsonl"), ("manifest", "manifest.json")):
                destination = staged / f"{purpose}.{suffix}"
                shutil.copyfile(getattr(source, key), destination)
                effective[purpose][key] = str(destination)
                replay[purpose][key] = f"inputs/{purpose}.{suffix}"
        config = ExperimentConfig.model_validate(effective)
        validate_inputs(config, check_output=False)
        replay["output_dir"] = "."
        write_json(output / "replay-config.json", replay)
        write_json(output / "resolved-config.json", config.model_dump())
        events.emit("EXPERIMENT_STARTED", {"runtime": runtime, "datasets": datasets})
        frozen = str(output / "resolved-config.json")
        for role in ("baseline", "training", "candidate"):
            if runtime_versions() != runtime:
                raise ValueError("Worker source or runtime changed between experiment phases")
            if role == "training":
                run_phase(
                    ["_train", "--config", frozen],
                    config.training.max_seconds,
                    output / "training.log",
                )
            else:
                events.emit("EVALUATION_STARTED", {"role": role, "evaluationRole": "development"})
                args = ["evaluate", "--config", frozen, "--output", str(output / f"{role}.json")]
                if role == "candidate":
                    training = json.loads((output / "training.json").read_text())
                    args += [
                        "--checkpoint",
                        str(output / "checkpoint"),
                        "--expected-hash",
                        training["checkpoint_sha256"],
                    ]
                run_phase(args, config.evaluation.max_seconds, output / f"{role}.log")
                report = json.loads((output / f"{role}.json").read_text())
                events.emit(
                    "EVALUATION_COMPLETED",
                    {
                        "role": role,
                        "accuracy": report["accuracy"],
                        "numExamples": report["num_examples"],
                        "evaluationRole": "development",
                        "reportSha256": file_sha256(output / f"{role}.json"),
                    },
                )
            if runtime_versions() != runtime:
                raise ValueError("Worker source or runtime changed during an experiment phase")
        baseline = json.loads((output / "baseline.json").read_text())
        candidate = json.loads((output / "candidate.json").read_text())
        comparison = compare(baseline, candidate, config.seed)
        write_json(output / "comparison.json", comparison)
        summary = {
            "schema_version": 1,
            "campaign_id": config.campaign_id,
            "experiment_id": config.experiment_id,
            "status": "completed",
            "completed_at": utc_now(),
            "elapsed_seconds": time.monotonic() - started,
            "comparison": comparison,
            "checkpoint_sha256": training["checkpoint_sha256"],
            "weights_changed": training["weights_changed"],
            "candidate_evaluated_in_fresh_process": True,
            "cost_usd": None,
            "cost_status": "not_measured_by_local_worker",
            "governance_status": "unreviewed",
            "promotion_authorized": False,
        }
        write_json(output / "result.json", summary)
        events.emit(
            "EXPERIMENT_COMPLETED",
            {
                "resultSha256": file_sha256(output / "result.json"),
                "improvementObserved": comparison["improvement_observed"],
                "promotionAuthorized": False,
            },
        )
        artifacts = {
            path.relative_to(output).as_posix(): file_sha256(path)
            for path in sorted(output.rglob("*"))
            if path.is_file()
        }
        write_json(
            output / "manifest.json",
            {
                "schema_version": 1,
                "campaign_id": config.campaign_id,
                "experiment_id": config.experiment_id,
                "created_at": utc_now(),
                "files": artifacts,
            },
        )
        return summary
    except BaseException as error:
        events.emit(
            "EXPERIMENT_FAILED",
            {
                "errorType": type(error).__name__,
                "message": str(error),
                "elapsedSeconds": time.monotonic() - started,
            },
        )
        write_json(
            output / "failure.json",
            {
                "status": "failed",
                "error_type": type(error).__name__,
                "message": str(error),
                "completed_at": utc_now(),
            },
        )
        raise


def verify_run(output: Path) -> dict:
    manifest = json.loads((output / "manifest.json").read_text())
    expected_files = manifest["files"]
    actual_files = {
        path.relative_to(output).as_posix(): path
        for path in output.rglob("*")
        if path.is_file() and path != output / "manifest.json"
    }
    if expected_files.keys() != actual_files.keys():
        raise ValueError("Artifact files were added or removed after the manifest was created")
    for relative, digest in expected_files.items():
        path = output / relative
        if not path.resolve().is_relative_to(output.resolve()) or path.is_symlink():
            raise ValueError("Artifact path is outside the run directory")
        if file_sha256(path) != digest:
            raise ValueError(f"Artifact checksum mismatch: {relative}")
    config = load_config(output / "resolved-config.json")
    baseline = json.loads((output / "baseline.json").read_text())
    candidate = json.loads((output / "candidate.json").read_text())
    recomputed = compare(baseline, candidate, config.seed)
    if recomputed != json.loads((output / "comparison.json").read_text()):
        raise ValueError("Stored comparison does not match sample-level evidence")
    training = json.loads((output / "training.json").read_text())
    result = json.loads((output / "result.json").read_text())
    checkpoint_files = directory_manifest(output / "checkpoint")
    checkpoint_hash = manifest_sha256(checkpoint_files)
    if training["checkpoint_files"] != checkpoint_files:
        raise ValueError("Training metadata does not match saved checkpoint files")
    if any(
        checkpoint_hash != record["checkpoint_sha256"] for record in (training, candidate, result)
    ):
        raise ValueError("Checkpoint identities differ across training, evaluation, and result")
    if training["weights_changed"] is not True or (
        training["initial_trainable_sha256"] == training["final_trainable_sha256"]
    ):
        raise ValueError("Training metadata does not demonstrate changed weights")
    if result["comparison"] != recomputed or result["status"] != "completed":
        raise ValueError("Result does not match completed evaluation evidence")
    if result["promotion_authorized"] is not False or result["governance_status"] != "unreviewed":
        raise ValueError("A training worker cannot grant governance approval")
    for record in (manifest, result, baseline, candidate):
        if (record["campaign_id"], record["experiment_id"]) != (
            config.campaign_id,
            config.experiment_id,
        ):
            raise ValueError(
                "Artifact campaign or experiment identities do not match configuration"
            )
    if baseline["model"] != config.model.model_dump():
        raise ValueError("Evaluation model differs from the frozen configuration")
    if (output / "replay-config.json").exists():
        replay = load_config(output / "replay-config.json")
        rows, dataset = load_dataset(replay.development, "development")
        if dataset.model_dump() != baseline["dataset"]:
            raise ValueError("Evaluated dataset differs from input snapshot")
        for row, sample in zip(rows, baseline["samples"], strict=True):
            if (row.id, row.question, str(extract_answer(row.answer))) != (
                sample["id"],
                sample["question"],
                sample["reference_answer"],
            ):
                raise ValueError("Evaluation samples differ from preserved input snapshot")
    return {
        "status": "verified",
        "num_artifacts": len(expected_files),
        "manifest_sha256": file_sha256(output / "manifest.json"),
        "note": "Hashes detect changes relative to this manifest; they are not a signature.",
    }
