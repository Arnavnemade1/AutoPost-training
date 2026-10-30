# Forge command center

This branch adds a runnable research interface, real SFT and GRPO, deterministic
governance gates, a separate Azure final evaluator, private Supabase evidence storage,
and authentic screen capture. The original training, signed-actor and orchestrator
packages remain available under their existing contracts.

The posted hackathon rules require code to be created during the event.
This earlier prototype is not claimed as eligible. See [verified event eligibility](event-eligibility.md).

## Work with the existing repository

The collaborator's latest incorporated commit is `d59509d`: worker
recovery, UTF-8/large-pipe handling, cancellation, attempt exhaustion, recipe replay,
and validation hardening. It is merged, not copied or rewritten.

| Existing work | How this branch uses or preserves it |
| --- | --- |
| `services/training-core/` | SFT calls its completion encoder, masked batch collation, prompt, dataset separation check, numeric scorer and Wilson intervals. Evidence export also uses its SHA-256 helpers and paired bootstrap. |
| `packages/terse-actors/` | Preserved signed-role, fenced-lease, outbox and ledger profile. Its original tests and commands remain intact. |
| `services/orchestrator/` | Preserved deterministic research profile, including the latest recovery fixes. It can run independently using its pinned training virtualenv. |
| Root `app/`, `components/`, `services/core/` | Command-center profile: model-backed proposals, real SFT/GRPO, live metrics, governance, independent final evaluation and recording. |

The command-center profile currently uses five Python actors under `services/actors/`.
It does **not** claim to exercise the seven TypeScript actors. Both profiles use real
Terse and Agent Relay. They have different dependency pins and trust boundaries;
keep their virtualenvs, runtime data directories and ports separate. The root UI is
connected to the root Python service, not to undocumented collaborator artifact files.

## Start locally

Requirements: Node 24, Python 3.12, `uv`, and an Apple Metal or CUDA device for practical
training speed. CPU works but is slower. The demonstrated training host is an Apple
M3 with 16 GB memory. The independent evaluator uses a separate Linux CPU VM.

```sh
npm ci
uv sync --extra advanced
cp .env.example .env
chmod 600 .env
npm run lab
```

Open <http://127.0.0.1:3000>. The launcher starts/reuses Terse (7100), Relaycast (7528),
the recipient-verifying Relay bridge (7529), the API (8000), and Next.js (3000).
Services bind to loopback. The API is a trusted local control plane, without a public
authentication layer. Do not expose these ports publicly.

On macOS, a supervisor can keep the lab alive across terminal/chat interruptions:

```sh
.venv/bin/python scripts/service.py start
.venv/bin/python scripts/service.py status
.venv/bin/python scripts/service.py stop
```

The launchd registration ends at logout. It does not install a login item. Worker
processes prevent idle system sleep only while that worker is alive. An interrupted
worker is detected by its actual PID and command, marked interrupted, and retains
completed evidence. Optimization is not resumed automatically from a partial step.

## Configure connections

Keep secrets in ignored `.env`, with mode 600. No secret belongs in `NEXT_PUBLIC_*`.
The supplied example lists each supported setting. Without a model key, the director
uses an explicitly labeled deterministic local policy. With Azure/OpenAI it requests
a typed proposal; only allowed strategies, ranks and learning rates can execute.

For independent evaluation, authenticate `az` to the authorized subscription and run:

```sh
.venv/bin/python scripts/azure-worker.py
```

The script owns only `forge-eval-338fedca` and provisions/reuses a bounded ARM Linux
CPU evaluator. It sets a two-hour automatic shutdown. Verify subscription quotas and
the printed resource identity before using it in another account. Cloud GPUs were
not available under this subscription's tested quota; training uses the local GPU.

Subsequent independent evaluations wake only this configured worker on demand and
wait for the Azure guest agent. A fresh two-hour shutdown bounds each wake. No
public SSH rule is required; dispatch uses Azure Run Command and scoped object grants.

The evaluator receives an expiring read grant for its frozen input and separate
object-scoped upload grants for progress and output. It receives no Supabase service
key or OpenAI credential. The parent validates the input hash and returned job hash.
No local scoring fallback substitutes for a failed independent benchmark.

For Supabase, apply `supabase/migrations/202610280001_forge_evidence.sql` to the
configured project. The archive bucket is private and the snapshots table has RLS
enabled with no anonymous policies. Dashboard downloads pass through the local API,
which checks the registered SHA-256 before serving a file. The database is an archive;
Terse remains the authority for critical coordination.

## Research and evaluation protocol

- Model: `Qwen/Qwen2.5-0.5B-Instruct`, revision
  `7ae557604adf67be50417f59c2c2f167def9a775`, Apache 2.0.
- Data: `openai/gsm8k`, revision
  `740312add88f781978c0658806c59bc2815b9866`, MIT.
- Research reads only the pinned training Parquet file. Seeded training and
  development partitions are disjoint. Oversize training examples are excluded and
  identified, rather than silently truncated.
- SFT: completion-only LoRA on `q_proj`/`v_proj`, rank 8 or 16, maximum sequence
  length 768, fixed seed, clipped gradients, real per-step loss, saved adapter hashes.
  Broad and targeted SFT differ in which permitted worked solutions they weight.
- GRPO: TRL 1.16.0, four generations, at most eight optimizer steps. Each generated
  answer becomes a unique versioned Terse world action. The returned deterministic
  reward feeds TRL. Trajectories retain source IDs, policy steps and parameter hashes.
- Development: the shared `forge_numeric_v1` final `#### <number>` scorer, greedy
  generation capped at 256 tokens. This is a diagnostic, not a leaderboard score.
- Regression: four declared arithmetic questions. A drop greater than 25 percentage
  points blocks promotion. This small suite does not establish broad model safety.
- Selection uses development evidence and governance approval only. Selection freezes
  before test data is allocated. Previously allocated final IDs are excluded even
  when a prior evaluation failed; the final claim cannot be retried to select a model.
- Independent final: `lm-evaluation-harness` 0.4.13, official GSM8K task v3,
  strict-match exact match, five-shot prompt, 256-token cap, identical baseline and
  candidate settings. The frozen subset size and sample predictions are disclosed.
  This is a GSM8K subset result, not a full official leaderboard submission.

The language-model director sees bounded development evidence and prior experiment
results. It cannot emit executable code or alter the objective, reward, model,
benchmark, file paths or final-data policy. Failed experiments remain visible and are
included in its next decision. A campaign may legitimately find no improvement.

## Governance and local trust boundary

Objective/configuration, policy and terminal reviews are immutable in the actors.
Promotion requires an approved review bound to exact registered weight/evaluation
hashes, changed weights, independent reload, provenance and the regression boundary.
A review arriving before its artifacts cannot bypass the registry check. The
controlled integrity probe requests a modified reward and sealed-data access, then
attempts promotion. Both rejection and the real blocked promotion are recorded.
It is clearly labeled a fixture, not a naturally discovered attack.

These are deterministic controls under a trusted local orchestrator. Local processes
share runtime access, and this profile does not provide hostile-process isolation or
separately deployed role credentials. The collaborator's signed-role actor profile
provides a stronger authorization foundation. Neither local profile alone establishes
cloud durability, general alignment or a broad safety guarantee.

## Record and export

Install `agent-browser` and its supported Chromium, plus FFmpeg. The recorder opens
an isolated named browser, starts a continuous 1440×1000 WebM **before** clicking
Launch, and captures unmodified PNG checkpoints with UTC timestamps. It visits the
controlled governance probe and the final results while real research continues.

```sh
.venv/bin/python scripts/capture.py --launch --interval 5
# macOS: same one-shot capture job, protected from a chat interruption
.venv/bin/python scripts/service.py capture
# One queued campaign, no recurring automation:
.venv/bin/python scripts/service.py record-after --launch --experiments 3 --steps 96 --final-samples 24 --export
```

Only one campaign owns the GPU. An existing registered capture job is not started a
second time. A recording warning appears in the launch form; recording failures are
prominent in the workspace. A saved recording is distinct from an active recording.

After a completed campaign, using the actual run ID:

```sh
.venv/bin/python scripts/export-evidence.py --campaign RUN_ID
.venv/bin/python scripts/render-video.py --campaign RUN_ID
```

Outputs live under ignored `artifacts/RUN_ID/`: adapters, per-sample evaluations,
reports, all environment trajectories, Relay references, and `recording/` with the
original WebM, full-speed MP4, `training_100x.mp4`, `training_120x.mp4`, capture markers
and exact FFmpeg commands. Video duration is checked against the source and speed.
Accelerated exports sample frames at 30fps; they never fabricate intermediate states.
The original continuous capture remains available. Artifact files are registered and
mirrored privately. Never publish `independent-final/job.json` or `dispatch.sh`, which
contain expiring object grants. The downloadable reproducibility file strips them.

`--export` also records historical views of the completed evidence and builds a
two-minute demo with factual captions. The source tour is explicitly historical;
the training time-lapse comes from the continuous original recording. Demo captions
and edit commands are preserved in `recording/demo-manifest.json`.

To repeat the frozen final evaluation on Linux CPU with the same dependency lock:

```sh
.venv/bin/python scripts/reproduce-final.py \
  --manifest /path/to/reproducibility.json \
  --checkpoint /path/to/extracted-selected-adapter \
  --output /path/to/new-reproduction-directory
```

This historical reproduction checks the exact adapter hash and uses the original
frozen questions. It does not run research, change selection or consume a new test
subset. Compare its recorded counts and raw harness outputs to the original report.

## Verify changes

```sh
npm run lint
npm run test:relay
npm run typecheck
npm run format:check
npm run build
.venv/bin/ruff check services/core services/api.py services/actors/src scripts tests
.venv/bin/ruff format --check services/core services/api.py services/actors/src scripts tests
.venv/bin/python -m pytest tests -q
FORGE_LIVE_RELAY_TEST=1 .venv/bin/python -m pytest tests/test_relay.py -q
```

The root native-runtime tests exercise reservations, duplicate/stale actions,
artifact/review orderings, veto enforcement and actual SIGKILL/restart. Recovery tests
kill a real worker process and exercise simultaneous SQLite writes across processes.
Use the original packages' READMEs and pinned virtualenv to verify their independent
profiles. Do not install their older training pins into the running root virtualenv.
