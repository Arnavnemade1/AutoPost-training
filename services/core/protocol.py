"""The evaluation protocol shared by every backend. Pure Python: no torch, no model."""

import time
from decimal import Decimal, InvalidOperation
from pathlib import Path

from forge_training.artifacts import file_sha256
from forge_training.scoring import extract_answer, wilson_interval
from services.core.contracts import MODEL_REVISION

DATASET_REVISION = "740312add88f781978c0658806c59bc2815b9866"
PROMPT_VERSION = "math_completion_v1"
MAX_NEW_TOKENS = 256


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


def collect(rows, predictions, progress, split, worlds, started, device, batch_size=1, seconds=None):
    """Score streamed predictions in row order: Terse worlds, progress and the summary stay local."""
    results = []
    # Not strict: a remote stream carries its final result after the last prediction.
    for i, (row, p) in enumerate(zip(rows, predictions, strict=False)):
        if p["id"] != row["id"]:
            raise ValueError(f"Prediction {p['id']} arrived for row {row['id']}")
        env = worlds(row, p["answer"], i) if worlds else None
        p = {**p, "correct": env["reward"] == 1 if env is not None else p["correct"]}
        p["environment_id"] = env["id"] if env else None
        results.append(p)
        progress(i + 1, len(rows), p)
    if len(results) != len(rows):
        raise RuntimeError(f"Evaluation returned {len(results)} of {len(rows)} predictions")
    n = len(results)
    correct = sum(p["correct"] for p in results)
    return {
        "score": correct / n if n else 0,
        "n": n,
        "correct": correct,
        # Wilson interval for the subset. No claim of statistical significance.
        "ci95": wilson_interval(correct, n),
        "predictions": results,
        "split": split,
        "benchmark": "GSM8K subset",
        "dataset_revision": DATASET_REVISION,
        "scoring": "forge_numeric_v1, strict final #### numeric line (shared training-core scorer)",
        "prompt_version": PROMPT_VERSION,
        "decoding": {"do_sample": False, "max_new_tokens": MAX_NEW_TOKENS, "batch_size": batch_size},
        "seconds": time.monotonic() - started if seconds is None else seconds,
        "model_revision": MODEL_REVISION,
        "device": device,
    }
