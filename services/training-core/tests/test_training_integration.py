from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from forge_training.artifacts import file_sha256
from forge_training.config import load_config
from forge_training.evaluation import compare
from forge_training.fixtures import make_smoke_fixture
from forge_training.training import collate_completion, encode_completion
from forge_training.worker import run_experiment, run_phase, verify_run


@pytest.fixture(scope="module")
def actual_run(tmp_path_factory):
    directory = tmp_path_factory.mktemp("real-optimization") / "fixture"
    config_path = make_smoke_fixture(directory)
    result = run_experiment(config_path)
    return directory, result


@pytest.mark.integration
def test_real_optimizer_saved_adapter_and_independent_evaluation(actual_run):
    from safetensors.torch import load_file

    directory, result = actual_run
    output = directory / "run"
    training = json.loads((output / "training.json").read_text())
    assert training["optimizer_steps"] == 3
    assert training["initial_trainable_sha256"] != training["final_trainable_sha256"]
    weights = load_file(output / "checkpoint/adapter_model.safetensors")
    assert any(
        tensor.count_nonzero().item() > 0 for name, tensor in weights.items() if "lora_B" in name
    )
    assert result["candidate_evaluated_in_fresh_process"]
    assert not result["promotion_authorized"]
    assert result["cost_usd"] is None
    assert verify_run(output)["status"] == "verified"
    events = [json.loads(line) for line in (output / "events.jsonl").read_text().splitlines()]
    assert len({event["eventId"] for event in events}) == len(events)
    assert any(event["type"] == "TRAINING_PROGRESS" for event in events)


@pytest.mark.integration
def test_prompt_and_padding_are_masked_without_losing_eos(actual_run):
    from transformers import AutoTokenizer

    from forge_training.config import Example

    directory, _ = actual_run
    tokenizer = AutoTokenizer.from_pretrained(directory / "base-model", local_files_only=True)
    examples = [
        Example(id="one", question="What is 1 plus 1?", answer="#### 2"),
        Example(id="two", question="1?", answer="#### 2"),
    ]
    records = [encode_completion(tokenizer, example, 128) for example in examples]
    batch = collate_completion(records, tokenizer.eos_token_id, "cpu")
    assert all(-100 in row["labels"] for row in records)
    for index, record in enumerate(records):
        eos_position = len(record["input_ids"]) - 1
        assert batch["labels"][index, eos_position] == tokenizer.eos_token_id
        assert (batch["labels"][index, eos_position + 1 :] == -100).all()


@pytest.mark.integration
def test_repeated_run_refuses_to_overwrite_evidence(actual_run):
    directory, _ = actual_run
    before = file_sha256(directory / "run/manifest.json")
    with pytest.raises(FileExistsError):
        run_experiment(directory / "experiment.json")
    assert file_sha256(directory / "run/manifest.json") == before


@pytest.mark.integration
def test_changed_evaluation_settings_and_score_inflation_are_rejected(actual_run):
    directory, _ = actual_run
    baseline = json.loads((directory / "run/baseline.json").read_text())
    candidate = json.loads((directory / "run/candidate.json").read_text())
    candidate["protocol"]["seed"] += 1
    with pytest.raises(ValueError, match="different protocol"):
        compare(baseline, candidate, 42)
    candidate["protocol"]["seed"] -= 1
    candidate["accuracy"] = 1.0
    with pytest.raises(ValueError, match="Aggregate score"):
        compare(baseline, candidate, 42)


@pytest.mark.integration
def test_checkpoint_tampering_and_wrong_identity_fail_closed(actual_run, tmp_path):
    directory, result = actual_run
    tampered = tmp_path / "tampered-checkpoint"
    shutil.copytree(directory / "run/checkpoint", tampered)
    with (tampered / "adapter_model.safetensors").open("ab") as stream:
        stream.write(b"tampered")
    process = subprocess.run(
        [
            sys.executable,
            "-m",
            "forge_training",
            "evaluate",
            "--config",
            str(directory / "experiment.json"),
            "--checkpoint",
            str(tampered),
            "--expected-hash",
            result["checkpoint_sha256"],
            "--output",
            str(tmp_path / "bad.json"),
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert process.returncode != 0
    assert "Checkpoint checksum mismatch" in process.stderr
    assert not (tmp_path / "bad.json").exists()


@pytest.mark.integration
def test_artifact_edits_are_detected(actual_run, tmp_path):
    directory, _ = actual_run
    copy = tmp_path / "run-copy"
    shutil.copytree(directory / "run", copy)
    (copy / "candidate.json").write_text("{}")
    with pytest.raises(ValueError, match="checksum mismatch"):
        verify_run(copy)


@pytest.mark.integration
def test_saved_candidate_predictions_repeat_in_another_process(actual_run, tmp_path):
    directory, result = actual_run
    report = tmp_path / "repeated.json"
    subprocess.run(
        [
            sys.executable,
            "-m",
            "forge_training",
            "evaluate",
            "--config",
            str(directory / "experiment.json"),
            "--checkpoint",
            str(directory / "run/checkpoint"),
            "--expected-hash",
            result["checkpoint_sha256"],
            "--output",
            str(report),
        ],
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )
    expected = json.loads((directory / "run/candidate.json").read_text())
    assert json.loads(report.read_text())["samples"] == expected["samples"]
    assert load_config(directory / "experiment.json").model.model_status == "fixture"


@pytest.mark.integration
def test_token_budget_failure_cannot_emit_success(actual_run, tmp_path):
    directory, _ = actual_run
    config = load_config(directory / "experiment.json").model_dump()
    config["training"]["max_training_tokens"] = 1
    config["output_dir"] = str(tmp_path / "budget-limited-run")
    config_path = tmp_path / "budget-config.json"
    config_path.write_text(json.dumps(config))
    with pytest.raises(RuntimeError, match="Worker subprocess failed"):
        run_experiment(config_path)
    output = Path(config["output_dir"])
    assert "token budget" in (output / "training.log").read_text()
    assert (output / "failure.json").exists()
    assert not (output / "manifest.json").exists()
    assert not (output / "result.json").exists()


@pytest.mark.integration
def test_parameter_limit_is_checked_before_loading_weights(actual_run, monkeypatch):
    from transformers import AutoModelForCausalLM

    from forge_training.config import ExperimentConfig
    from forge_training.modeling import load_base

    directory, _ = actual_run
    body = load_config(directory / "experiment.json").model_dump()
    body["max_model_parameters"] = 1

    def should_not_load(*args, **kwargs):
        raise AssertionError("Real model weights were loaded before checking the parameter cap")

    monkeypatch.setattr(AutoModelForCausalLM, "from_pretrained", should_not_load)
    with pytest.raises(ValueError, match="before weight loading"):
        load_base(ExperimentConfig.model_validate(body))


def test_subprocess_deadline_really_stops_the_worker(monkeypatch, tmp_path):
    package = tmp_path / "forge_training"
    package.mkdir()
    (package / "__init__.py").write_text("")
    (package / "__main__.py").write_text(
        "import os, time\nprint(os.getpid(), flush=True)\ntime.sleep(30)\n"
    )
    monkeypatch.setenv("PYTHONPATH", str(tmp_path))
    monkeypatch.chdir(tmp_path)
    log = tmp_path / "deadline.log"
    with pytest.raises(subprocess.TimeoutExpired):
        run_phase([], timeout=1, log=log)
    pid = int(log.read_text().strip())
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


@pytest.mark.integration
def test_input_snapshots_and_replay_survive_moving_the_bundle(actual_run, tmp_path):
    directory, result = actual_run
    moved = tmp_path / "moved-run"
    shutil.copytree(directory / "run", moved)
    replay = moved / "replay-config.json"
    config = load_config(replay)
    assert Path(config.development.records).is_relative_to(moved)
    assert verify_run(moved)["status"] == "verified"
    process = subprocess.run(
        [
            sys.executable,
            "-m",
            "forge_training",
            "evaluate",
            "--config",
            str(replay),
            "--checkpoint",
            str(moved / "checkpoint"),
            "--expected-hash",
            result["checkpoint_sha256"],
            "--output",
            str(tmp_path / "moved-evaluation.json"),
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert process.returncode == 0, process.stderr


def test_runtime_changes_fail_before_training(config_file, config, monkeypatch):
    import forge_training.worker as worker

    changed = False

    def versions():
        return {"source_sha256": "changed" if changed else "original"}

    def fake_baseline(arguments, timeout, log):
        nonlocal changed
        output = Path(arguments[arguments.index("--output") + 1])
        output.write_text(json.dumps({"accuracy": 0.0, "num_examples": 1}))
        changed = True

    monkeypatch.setattr(worker, "runtime_versions", versions)
    monkeypatch.setattr(worker, "run_phase", fake_baseline)
    with pytest.raises(ValueError, match="runtime changed"):
        worker.run_experiment(config_file)
    assert (Path(config.output_dir) / "failure.json").exists()
    assert not (Path(config.output_dir) / "training.json").exists()
