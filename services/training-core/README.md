# Forge training core

A working local worker for real completion-only LoRA optimization and independently
loaded development evaluation. Requires Python 3.11+. Dependencies are pinned in
`pyproject.toml`; CUDA, MPS, and CPU are explicit choices.

```sh
cd services/training-core
python3.11 -m venv .venv
.venv/bin/python -m pip install -e '.[train,test,data]'
.venv/bin/python -m pytest -q
.venv/bin/ruff check src tests
.venv/bin/ruff format --check src tests
.venv/bin/forge-train smoke --output /tmp/forge-mechanics-unique-run
```

Use a new output path for every run. The smoke command creates an offline random tiny
GPT-2, synthetic arithmetic data, executes actual optimization, evaluates the saved
adapter in a fresh process, and verifies the resulting manifest. Its scores have no
useful-model benchmark significance.

For the pinned Qwen development example:

```sh
.venv/bin/forge-train prepare-gsm8k --output data/gsm8k \
  --revision 740312add88f781978c0658806c59bc2815b9866 \
  --train-size 256 --dev-size 64
.venv/bin/forge-train validate --config examples/qwen-development.json
.venv/bin/forge-train run --config examples/qwen-development.json
.venv/bin/forge-train verify --run-dir artifacts/qwen-sft-001
```

The example uses an existing CUDA GPU and bfloat16. Change to `mps`/`float32` for Apple
GPU or `cpu`/`float32` for CPU, and set suitable phase limits. It does not provision
cloud GPUs. Downloaded model/data access uses Hugging Face's normal local cache.

Training and development are disjoint partitions of the official GSM8K **training**
file. The official test file is not requested by data preparation. Development
accuracy uses a versioned custom exact numeric scorer and must not be represented
as an official GSM8K result. Repeated trials on a small dev set can overfit it.

Reports include predictions, decoding settings, dataset provenance, checksums,
before/after trainable-weight hashes, Wilson intervals, paired differences, and
bootstrap uncertainty. The worker reports unmeasured monetary cost as `null` and
never grants checkpoint promotion. Monetary accounting, separate credentials,
sealed final evaluation, safety/regression checks, Terse, and Relay belong to the
next architectural phases.

`evaluation.batch_size` (default 1) generates in left-padded greedy batches and is part
of the frozen protocol. `run --frozen-baseline <report> --frozen-baseline-sha256 <hash>`
reuses a campaign's untrained evaluation instead of repeating it, when it matches the run
exactly. Model-loading commands take a host-wide `flock` (`~/.cache/forge/model-job.lock`,
override with `FORGE_MODEL_LOCK`, disable with `FORGE_MODEL_LOCK=off`), so one machine
runs one model job at a time.

See the [integration contract](../../docs/training-core-contract.md) for event fields,
artifact formats, process boundaries, failure handling, and deployment requirements.
