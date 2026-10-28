# Training-core integration contract, v1

Status: implemented local worker contract. No Terse, Agent Relay, governance service,
GPU-provider billing, final benchmark, or dashboard integration is claimed here.

## Ownership and installation

The training workstream owns `services/training-core/`. It is an independently
installable Python 3.11+ package with its own pinned dependencies, tests, and CLI.
Other agents should consume these boundaries rather than modifying worker internals
without checking the current diff. Root application dependencies are intentionally
separate. The worker runs directly on CPU, Apple MPS, or an existing CUDA device.
It does not provision compute or submit paid jobs.

```sh
cd services/training-core
python3.11 -m venv .venv
.venv/bin/python -m pip install -e '.[train,test,data]'
.venv/bin/forge-train schema --kind experiment
.venv/bin/forge-train schema --kind evaluation
```

The CLI emits JSON to stdout, errors as JSON to stderr, and returns a nonzero exit
code on failure. Its JSON Schemas are generated from the same strict Pydantic models
used at runtime; unknown configuration fields are rejected.

## Job lifecycle

The orchestrator, after independent approval and an actor-owned budget reservation,
creates one immutable experiment configuration and invokes:

```sh
forge-train validate --config /absolute/path/experiment.json
forge-train run --config /absolute/path/experiment.json
forge-train verify --run-dir /absolute/path/run
```

`validate` checks schema, input checksums, partition purpose, duplicate IDs/questions,
reference-answer format, and input/output path separation. It does not load a model
or prove GPU availability. `run` repeats validation, claims a new output directory
exclusively, then runs baseline evaluation, LoRA optimization, and candidate evaluation
in separate subprocesses. Any existing output directory causes a failure. Use a new
experiment ID and new directory for a retry; actor state controls whether it is allowed.

Both evaluations use the same frozen development dataset, prompt, decoding settings,
device, precision, seed, scorer, and library versions. Model generation is greedy.
The candidate evaluation reconstructs the pinned base and loads the saved adapter,
checking its directory checksum and base identity/revision before use.

Local model references use a SHA-256 over sorted relative filenames and their content
hashes; Hub model references require a 40-character commit. Only safetensors model
weights are accepted; `trust_remote_code` is disabled. These restrictions do not replace
the separate sandbox and model/data allowlist required in production.

## Resource and authorization boundaries

Per-phase wall-clock deadlines include subprocess startup/model loading, with process
group termination on timeout. Optimization also checks a maximum training-token budget
before each microbatch, bounded steps/sequence length/batch size, finite loss/gradients,
and changed trainable weights. Oversize examples fail rather than being truncated.
Phase limits are enforced locally; total campaign time, concurrent jobs, retries, GPU
allocation, and monetary reservations belong to the authoritative campaign actor.

`cost_usd` is `null`, since this worker does not have provider billing evidence.
Never replace that value with zero or interpret elapsed seconds as billed cost.
There is no checkpoint promotion API in the worker. Successful output explicitly
records `governance_status: unreviewed` and `promotion_authorized: false`.

Run the worker under a scoped identity without protected test data, governance
credentials, host secrets, or arbitrary shell tooling. That permission isolation is
a deployment requirement, not something this local CLI claims to implement.

## Artifacts

Every completed run creates:

| Artifact | Meaning |
| --- | --- |
| `resolved-config.json` | Frozen effective configuration with absolute input paths |
| `environment.json` | Python/platform/library versions and training-worker source identity |
| `replay-config.json` | Equivalent configuration with bundle-relative dataset paths |
| `inputs/` | Exact train/development JSONL and manifest snapshots consumed by this run |
| `baseline.json` | Development baseline settings, scores, uncertainty, predictions |
| `training-metrics.jsonl` | Actual per-optimizer-step loss, token usage, timestamp |
| `training.json` | Before/after trainable-weight hashes, checkpoint identity, runtime |
| `checkpoint/` | PEFT adapter config, safetensors weights, generated model card |
| `candidate.json` | Fresh-process evaluation of the saved adapter |
| `comparison.json` | Paired example outcomes and bootstrap interval in percentage points |
| `result.json` | Worker outcome with explicit evidence and authorization scope |
| `events.jsonl` | Correlated real worker events |
| `baseline.log`, `training.log`, `candidate.log` | Subprocess diagnostic output |
| `manifest.json` | SHA-256 for every artifact above, including checkpoint files |

Failed runs retain logs/events and `failure.json`. They do not emit a successful run
manifest or promote a partial adapter. An intermediate training checkpoint can remain
if later evaluation fails; consumers must require completed `result.json`, a valid
manifest, independent review, and the actor's authorized promotion transition.

`verify` checks the complete artifact set and content hashes and recomputes comparison
from validated sample-level predictions. Scores, counts, diagnoses, and Wilson intervals
are recomputed when reading an evaluation report, so aggregate score inflation fails.
The manifest is a content-integrity record, **not a signature**. The governance layer
must bind its hash to an independent trusted record; a writer that can alter all files
and their manifest is outside the worker's threat boundary.

The worker also fingerprints its Python source and rejects runtime/source changes
between phases or during evaluation. Use immutable worker images for deployments.

## Progress events

```json
{
  "schemaVersion": 1,
  "eventId": "sft-lora-001:optimizer:2",
  "campaignId": "qwen-math-development",
  "experimentId": "sft-lora-001",
  "producer": "optimizer",
  "sequence": 2,
  "timestamp": "2026-10-28T04:00:00+00:00",
  "type": "TRAINING_PROGRESS",
  "payload": {
    "step": 1,
    "loss": 2.4,
    "training_tokens": 180,
    "elapsed_seconds": 1.5,
    "timestamp": "2026-10-28T04:00:00+00:00"
  }
}
```

This is an illustrative payload, not a recorded metric. Event sequences are scoped
to each producer (`worker` or `optimizer`); use the file order for local replay.
Experiment IDs must be unique within the actor-owned campaign. Deduplicate by event
ID on ingestion. Supported worker event types: `EXPERIMENT_STARTED`,
`EVALUATION_STARTED`, `EVALUATION_COMPLETED`, `TRAINING_STARTED`, `TRAINING_PROGRESS`,
`TRAINING_COMPLETED`, `EXPERIMENT_COMPLETED`, `EXPERIMENT_FAILED`.

Relay transports assignments/findings/notifications. Terse persists authorization
and lifecycle state. A log event alone is not authorization to spend, evaluate sealed
data, or promote. Reconcile artifact state after missed events or worker failures.

## Development scoring and final evaluation

`forge_numeric_v1` requires a final `#### <number>` line and compares finite decimal
numeric values exactly, accepting properly grouped commas. The prompt explicitly asks
for that format. Invalid formatting is reported separately from a wrong numeric answer.
The scorer rejects malformed references. No hidden reference is included in the model
prompt. Train loss masks prompt and padding tokens while preserving real EOS labels.

`prepare-gsm8k` downloads only the pinned **training Parquet file**, then creates seeded
disjoint research train/development partitions with preserved source indices. Calling
the named dataset builder with `split="train"` was observed to prepare both partitions;
the implementation avoids that behavior and has a regression test for it.

All scores from this worker are **custom development diagnostics**, not official
GSM8K leaderboard results. Small development samples cannot establish generalization.
No regression suite or sealed final evaluation is implemented in this package.

The final evaluator must use a pinned established harness, a frozen selected candidate,
identical baseline/candidate settings, and separate credentials/storage for the test
split. The director must never select a checkpoint using final scores. Dataset
manifests in this worker do not accept a `test` split or `final` purpose; metadata
validation alone is not a security boundary against a malicious file writer.

## Verified commands

```sh
forge-train smoke --output /tmp/forge-mechanics-unique-run
forge-train prepare-gsm8k --output data/gsm8k \
  --revision 740312add88f781978c0658806c59bc2815b9866 \
  --train-size 256 --dev-size 64
forge-train run --config examples/qwen-development.json
```

The example uses CUDA/bfloat16. Choose `cpu`/float32 or `mps`/float32 explicitly for
local hardware and adjust the configured phase limits. The smoke fixture uses an
offline randomly initialized tiny GPT-2 and synthetic arithmetic. Its role is to
verify real optimization, saving, reload, reproducibility, and failure controls.
It provides no evidence of improving a useful pretrained model.
