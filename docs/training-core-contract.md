# Training-core integration contract, v1

Status: implemented local worker contract. Methods: completion-only SFT LoRA
(`sft_lora`) and reward-driven GRPO (`grpo`), whose rewards come only from Terse world
transitions through the orchestrator's world gateway (see below). No GPU-provider
billing, final benchmark, or dashboard integration is claimed here.

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
forge-train run --config /absolute/path/experiment.json \
  [--frozen-baseline /absolute/path/baseline.json --frozen-baseline-sha256 <sha256>]
forge-train verify --run-dir /absolute/path/run
forge-train protocol --config /absolute/path/experiment.json
```

`validate` checks schema, input checksums, partition purpose, duplicate IDs/questions,
reference-answer format, and input/output path separation. It does not load a model
or prove GPU availability. `run` repeats validation, claims a new output directory
exclusively, then runs baseline evaluation, LoRA optimization, and candidate evaluation
in separate subprocesses. Any existing output directory causes a failure. Use a new
experiment ID and new directory for a retry; actor state controls whether it is allowed.

With `--frozen-baseline`, `run` reuses the campaign's untrained evaluation instead of
repeating it, but only if the file matches the given SHA-256 and has no checkpoint, the
same campaign and model, the same staged development data and samples, and an identical
protocol (which includes this package's source hash and runtime versions). The run
records `baseline_source: {kind: "frozen", sha256}`, and `verify` checks the reused
file by that hash instead of requiring the run's own experiment ID. `protocol` prints
the identity an untrained evaluation depends on, for caching such reports by key.

`run`, `_train`, `evaluate` and `smoke` take a host-wide model-job lock (`flock` on
`~/.cache/forge/model-job.lock`, or `FORGE_MODEL_LOCK`; `off` disables it) before any
phase deadline starts, so one machine runs at most one model job at a time. Phase
subprocesses of a held job inherit it. The operating system releases the lock when its
holder exits. `FORGE_MODEL_LOCK_TIMEOUT` bounds the wait (default 7,200 seconds).

Both evaluations use the same frozen development dataset, prompt, decoding settings,
device, precision, seed, scorer, and library versions. Model generation is greedy, in
left-padded batches of `evaluation.batch_size` (default 1). Batch size is part of the
protocol: padding can break near-ties differently, so baseline and candidates must
share it. A finished sequence ends at its first EOS; later positions are padding.
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

## Reward-driven training (GRPO)

`training.method: "grpo"` requires a `grpo` block and an answer-free task file as
`train`: its manifest declares `record_kind: "task"` and every record is strictly
`{"id", "question"}`, so a record carrying an answer fails to load. Development data
keep reference answers for the scorer. The trainer is TRL `GRPOTrainer` pinned at
**0.24.0** (the release built against Transformers 4.57); the worker refuses any other
TRL version, because it reads the exact advantages through that version's internals.

The only reward is the world's. For each completion the worker derives one action,
`final_answer_v1`: the final `#### <number>` line under the development scorer's rule,
without grouping commas, or the explicit submission `none` (scored 0). It posts each
update's actions to the loopback gateway named by `FORGE_WORLD_GATEWAY_URL` with the
per-job bearer `FORGE_WORLD_GATEWAY_TOKEN`; the gateway returns each `RLWorldActor`
transition. Only the training phase receives these variables. Transport failures and
HTTP 503 are retried with identical bytes; the gateway and the actor deduplicate.

Each update generates `training.batch_size * gradient_accumulation_steps` completions,
`grpo.num_generations` per prompt, with the current weights, and uses them once
(`num_iterations: 1`). The run stops without a checkpoint unless, for every update:

- its rollouts were generated by exactly the adapter the previous update produced;
- the advantages the trainer will optimize equal those recomputed from the world rewards
  (group mean baseline, divided by the group's standard deviation plus 1e-4);
- TRL's logged reward equals the mean world reward, and loss and gradient norm are finite;
- the token budget (prompt plus completion tokens) still holds, measured after generation
  and before the loss; and `max_steps` times the batch fits `grpo.max_rollouts`.

`grpo.init_adapter` (`path`, `sha256`) continues an existing adapter, for example an
approved SFT checkpoint, instead of a fresh LoRA. Its directory hash is checked before
use; it must name the same base model and revision and have the run's LoRA rank, alpha,
target modules and zero dropout. The run stages it as `inputs/parent-adapter/`, and the
lineage must start at its saved weights. The run's **baseline is then this starting
policy**: the baseline evaluation, a frozen baseline and the comparison all use the
adapter, so a reported change is the run's own, not the parent's.

Prompts longer than `grpo.max_prompt_tokens` fail instead of being truncated. A tokenizer
that emits token type IDs is refused: TRL 0.24 generates with them but computes the loss
without them, which would optimize a different policy than it sampled. Optional
`grpo.gradient_checkpointing` and small micro-batches reduce memory; accelerator caches
are released after generation and after each update.

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
| `rollouts.jsonl` | GRPO: per completion, update, group, task, generating policy hash, completion and token IDs, action, world transition (world, episode, action, state hash, reward) and advantage |
| `lineage/update-NNNNN/` | GRPO: adapter snapshots, the initial state and every `grpo.snapshot_every`-th update and the last |
| `manifest.json` | SHA-256 for every artifact above, including checkpoint files |

Failed runs retain logs/events and `failure.json`. They do not emit a successful run
manifest or promote a partial adapter. An intermediate training checkpoint can remain
if later evaluation fails; consumers must require completed `result.json`, a valid
manifest, independent review, and the actor's authorized promotion transition.

`verify` checks the complete artifact set and content hashes and recomputes comparison
from validated sample-level predictions. For GRPO runs it also re-derives each rollout's
action from its completion, each update's advantages from its rewards, every summary and
metric line, and the policy lineage: rollout batch *k* was generated by the policy update
*k − 1* produced, each saved snapshot and the checkpoint hash to their recorded policies,
and the staged training file contains only tasks. With a starting adapter it also checks
the staged copy's hash and that the lineage begins at its weights. Rewards are checked against the
recorded transitions here; the orchestrator checks those against the world journals. Scores, counts, diagnoses, and Wilson intervals
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
`EVALUATION_STARTED`, `EVALUATION_COMPLETED`, `EVALUATION_REUSED`, `TRAINING_STARTED`,
`ROLLOUTS_SCORED` (GRPO), `TRAINING_PROGRESS`, `TRAINING_COMPLETED`,
`EXPERIMENT_COMPLETED`, `EXPERIMENT_FAILED`.

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

GRPO needs the orchestrator's world gateway (`services/orchestrator/src/worlds.ts`);
Model weights load directly onto the configured accelerator, so a model is not held on
the CPU and the GPU at once (Qwen2.5-0.5B float32 on MPS: about 1.9 GB instead of 3.5 GB
at peak). `make_grpo_fixture` in `fixtures.py` builds an offline tiny model warm-started on the
answer format so world rewards vary within groups. Its tests use a labeled stub gateway.

The example uses CUDA/bfloat16. Choose `cpu`/float32 or `mps`/float32 explicitly for
local hardware and adjust the configured phase limits. The smoke fixture uses an
offline randomly initialized tiny GPT-2 and synthetic arithmetic. Its role is to
verify real optimization, saving, reload, reproducibility, and failure controls.
It provides no evidence of improving a useful pretrained model.
