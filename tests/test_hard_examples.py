import json
from collections import Counter

import pytest

from services.core import director, hard_examples, strategies, training


def row(i):
    return {"id": f"train-{i}", "question": f"q{i}", "answer": f"a <<1+{i}=x>>x\n#### {i}"}


def prediction(i, correct, finish="stop"):
    return {"id": f"train-{i}", "output": f"mine {i}\n#### {i}", "correct": correct, "finish_reason": finish}


def test_clean_reference_removes_only_calculator_annotations():
    text = "Cost is 4 * $20 = $<<4*20=80>>80.\n#### 80"
    assert hard_examples.clean_reference(text) == "Cost is 4 * $20 = $80.\n#### 80"


def test_build_targets_misses_with_references_and_hits_with_the_models_own_answer():
    rows = [row(i) for i in range(3)]
    built = hard_examples.build(
        rows, [prediction(0, False), prediction(1, True), prediction(2, True, "length")], 42
    )
    answers = {r["id"]: r["answer"] for r in built["rows"]}
    assert answers["train-0"] == "a x\n#### 0"
    assert answers["train-1"] == "mine 1\n#### 1"
    # A correct answer cut off at the token limit is not a behaviour worth holding in place.
    assert answers["train-2"] == "a x\n#### 2"
    assert (built["hard"], built["easy"], built["mined"]) == (2, 1, 3)
    assert built["hard_ids"] == ["train-0", "train-2"]


def test_build_gives_hard_rows_a_third_of_the_steps_and_never_repeats_easy_rows():
    rows = [row(i) for i in range(40)]
    predictions = [prediction(i, i >= 4) for i in range(40)]
    built = hard_examples.build(rows, predictions, 42)
    counts = Counter(r["id"] for r in built["rows"])
    assert all(counts[f"train-{i}"] == 1 for i in range(4, 40))
    assert sum(counts[f"train-{i}"] for i in range(4)) == 18
    assert all(counts[f"train-{i}"] >= 4 for i in range(4))
    assert built["rows"][0]["id"] in built["hard_ids"]


def test_build_refuses_when_there_is_nothing_to_mine_or_rows_are_misaligned():
    with pytest.raises(ValueError, match="nothing to mine"):
        hard_examples.build([row(0)], [prediction(0, True)], 42)
    with pytest.raises(ValueError, match="arrived for row"):
        hard_examples.build([row(0)], [prediction(1, False)], 42)


def test_mine_runs_the_base_model_in_chunks_and_reports_overall_progress():
    calls, reported = [], []

    class Backend:
        def load(self, adapter=None, model_id=None):
            calls.append(("load", adapter, model_id))
            return "model", "tokenizer"

        def evaluate(self, model, tokenizer, rows, progress, cancelled, split, pack):
            calls.append(("evaluate", len(rows), split))
            for i in range(len(rows)):
                progress(i + 1, len(rows), {})
            return {"predictions": [{"id": r["id"]} for r in rows]}

        def unload(self, model):
            calls.append(("unload", model))

    rows = [row(i) for i in range(hard_examples.CHUNK + 5)]
    found = hard_examples.mine(
        Backend(), {"model_id": "m"}, rows, lambda d, t, _p: reported.append((d, t)), lambda: False, None
    )
    assert [p["id"] for p in found] == [r["id"] for r in rows]
    assert calls[0] == ("load", None, "m") and calls[-1] == ("unload", "model")
    assert [c[1] for c in calls if c[0] == "evaluate"] == [hard_examples.CHUNK, 5]
    assert reported[-1] == (len(rows), len(rows))


def test_scheduled_rate_warms_up_and_decays_to_nearly_zero():
    rates = [training.scheduled_rate(1.0, s, 100) for s in range(100)]
    assert rates[0] == pytest.approx(0.1) and rates[9] == pytest.approx(1.0)
    assert rates[10] == pytest.approx(1.0) and rates[-1] < 0.001
    assert rates[10:] == sorted(rates[10:], reverse=True)


def evidence(score=0.8):
    return {"score": score, "n": 2, "predictions": [{"correct": False}]}


def test_local_director_changes_the_second_hard_example_run_using_the_evidence(monkeypatch):
    for name in ("OPENAI_API_KEY", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT"):
        monkeypatch.delenv(name, raising=False)
    config = {"objective": "Improve math", "strategies": ["hard_sft"]}
    first = director.propose(config, evidence(), [])
    assert (first["strategy"], first["learning_rate"], first["lora_rank"]) == ("hard_sft", 0.0001, 16)
    dropped = director.propose(config, evidence(), [{"strategy": "hard_sft", "score": 0.7}])
    assert dropped["learning_rate"] == 0.00005
    flat = director.propose(config, evidence(), [{"strategy": "hard_sft", "score": 0.8}])
    assert flat["learning_rate"] == 0.0002


def test_hard_examples_are_allowed_on_modal_for_qa_tasks_only():
    assert strategies.STRATEGIES["hard_sft"]["backends"] == ("local", "modal")
    assert strategies.STRATEGIES["hard_sft"]["kinds"] == ("qa",)
    assert "hard_sft" in json.dumps(strategies.listing())


class Tokenizer:
    pad_token_id = 0
    eos_token_id = 1
    chat_template = None

    def encode(self, text, add_special_tokens=False):
        return [2 + ord(c) % 60 for c in text[:40]]

    def save_pretrained(self, folder):
        pass


def tiny_model():
    import torch
    from transformers import Qwen2Config, Qwen2ForCausalLM

    torch.manual_seed(0)
    model = Qwen2ForCausalLM(
        Qwen2Config(
            vocab_size=64,
            hidden_size=16,
            intermediate_size=32,
            num_hidden_layers=1,
            num_attention_heads=2,
            num_key_value_heads=2,
            max_position_embeddings=128,
            attn_implementation="eager",
        )
    )
    return model.float()


@pytest.mark.parametrize("strategy,parts", [("hard_sft", training.HARD_ACCUMULATION), ("broad_sft", 1)])
def test_training_accumulates_and_schedules_for_hard_examples_only(tmp_path, monkeypatch, strategy, parts):
    monkeypatch.setattr(training, "load", lambda model_id=None: (tiny_model(), Tokenizer()))
    monkeypatch.setattr(training, "unload", lambda model: None)
    monkeypatch.setattr(training, "device_info", lambda: {"type": "cpu"})
    seen = []
    real = training.collate_completion
    monkeypatch.setattr(
        training,
        "collate_completion",
        lambda records, pad, device: seen.append(records[0]["input_ids"]) or real(records, pad, device),
    )
    metrics = []
    result = training.train(
        {"strategy": strategy, "learning_rate": 0.01, "lora_rank": 8},
        {"seed": 1, "train_steps": 4},
        [row(i) for i in range(6)],
        tmp_path / "adapter",
        metrics.append,
        lambda: False,
    )
    assert result["weights_changed"]
    assert len(seen) == 4 * parts
    record = json.loads((tmp_path / "adapter" / "training.json").read_text())
    assert record["gradient_accumulation"] == parts
    rates = [m["learning_rate"] for m in metrics]
    assert (rates == [0.01] * 4) == (strategy == "broad_sft")
    if strategy == "hard_sft":
        # Rows keep the order they arrive in.
        assert record["train_ids"] == [f"train-{i}" for i in range(6)]


def test_campaign_worker_mines_once_from_training_rows_and_never_from_protected_ones(tmp_path, monkeypatch):
    from unittest.mock import MagicMock

    from services.core import runner

    train_rows = [row(i) for i in range(6)]
    dev_rows = [row(i) for i in range(100, 103)]
    sealed_rows = [row(i) for i in range(200, 203)]
    config = {
        "objective": "Improve math",
        "model_id": "Qwen/Qwen3.5-4B",
        "strategies": ["hard_sft"],
        "max_experiments": 2,
        "max_seconds": 3600,
        "train_steps": 4,
        "dev_samples": 3,
        "final_samples": 3,
        "seed": 42,
    }
    (tmp_path / "forge-test").mkdir()
    snapshot = {"config": config}

    class Store:
        ARTIFACTS = tmp_path
        now = staticmethod(lambda: "now")
        event = staticmethod(lambda *a, **k: None)
        get = staticmethod(lambda cid: snapshot)
        patch = staticmethod(lambda cid, change: change(snapshot))

    class Backend:
        name = "modal"
        hardware = {"backend": "modal"}
        evaluations, trained = [], []

        def load(self, adapter=None, model_id=None):
            return adapter, None

        def unload(self, model):
            pass

        def close(self):
            pass

        def evaluate(
            self, model, tokenizer, rows, progress, cancelled, split="development", worlds=None, pack=None
        ):
            self.evaluations.append((split, model, [r["id"] for r in rows]))
            # The base model misses the first training row; a checkpoint gets everything right.
            predictions = [
                prediction(
                    int(r["id"].split("-")[-1]) if "train" in r["id"] else 0,
                    bool(model) or r["id"] != "train-0",
                )
                | {"id": r["id"]}
                for r in rows
            ]
            return {
                "score": 1.0 if model else 0.5,
                "n": len(rows),
                "correct": len(rows),
                "predictions": predictions,
                "seconds": 1,
            }

        def train(self, proposal, config, rows, folder, progress, cancelled, pack=None):
            folder.mkdir(parents=True, exist_ok=True)
            self.trained.append((proposal, rows))
            progress({"step": 1, "loss": 1.0})
            return {"weights_changed": True, "sha256": "abc"}

    actor = MagicMock()
    actor.snapshot.return_value = json.dumps({"consumed_seconds": 0, "reservations": {}})
    actor.claim_final.return_value = True
    experiment = MagicMock()
    experiment.snapshot.return_value = json.dumps({"metrics": []})
    for name, value in {
        "store": Store,
        "actor": lambda cid: actor,
        "get_actor": lambda *a: experiment,
        "cancelled": lambda cid: False,
        "send": lambda *a, **k: {"message_id": "m"},
        "react": lambda *a: None,
        "transition": lambda *a: None,
        "publish": lambda cid: None,
        "artifact": lambda *a: {"id": "a", "sha256": "s"},
        "checkpoint_zip": lambda folder: folder,
        "add_review": lambda cid, review: {"decision": "approved", "reason_codes": []},
        "governance": lambda cid: MagicMock(),
        "final_verdict": lambda *a: {"improvement_claim": "none"},
    }.items():
        monkeypatch.setattr(runner, name, value)
    monkeypatch.setattr(runner.compute, "open_backend", lambda **k: Backend())
    monkeypatch.setattr(
        runner.packs, "data", lambda pack, config: (train_rows, dev_rows, lambda: sealed_rows)
    )
    monkeypatch.setattr(runner.training, "sha", lambda path: "abc")
    monkeypatch.setattr("services.core.cloud.mirror", lambda cid: None)

    runner.run("forge-test")

    mining = [e for e in Backend.evaluations if e[0] == "training mining"]
    assert len(mining) == 1, "a second experiment reuses the first mining pass"
    assert mining[0][1] is None, "mining runs on the base model, not a checkpoint"
    assert mining[0][2] == [r["id"] for r in train_rows]
    assert len(Backend.trained) == 2
    assert Backend.trained[0][0]["learning_rate"] != Backend.trained[1][0]["learning_rate"]
    answers = {r["id"]: r["answer"] for r in Backend.trained[0][1]}
    assert answers["train-0"] == "a x\n#### 0" and answers["train-1"] == "mine 1\n#### 1"
    assert not set(answers) & {r["id"] for r in dev_rows + sealed_rows}
    summary = json.loads((tmp_path / "forge-test" / "hard-examples.json").read_text())
    assert summary == {"mined": 6, "hard": 1, "easy": 5, "hard_ids": ["train-0"]}
    assert snapshot["final"]["checkpoint_id"] == "forge-test-exp-001"
