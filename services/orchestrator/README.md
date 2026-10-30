# Forge orchestrator

Durable Terse outbox messages travel over **Agent Relay** (`@agent-relay/sdk@14.0.0`)
between director, data researcher, reviewer, coordinator, worker and evaluator roles
(Phase 3). A worker adapter runs the Phase 1 Python trainer only for a Relay-delivered,
preflight-approved assignment that matches a local job allowlist. A deterministic
research director chooses each experiment from measured development results and
records its reasoning in the Terse research ledger (Phase 4). GRPO jobs score every
completion through a world gateway whose rewards are `RLWorldActor` transitions, and
every consumer re-checks those rewards against the worlds' journals (Phase 6). After the
campaign stops, `--finalize` freezes the promoted checkpoint and drives training-core's
pinned harness to package and rehearse a release; the sealed test runs once, separately
(Phase 8).

## Run

Requires Node 22+, npm, a supported native Terse platform, and the training-core
virtualenv (see `services/training-core/README.md`). Install the actor package first:
this service imports its sources and local runtime.

```sh
npm ci --prefix packages/terse-actors
cd services/orchestrator
npm ci
npm run check
npm run format:check
FORGE_PYTHON=/absolute/path/to/training-core/.venv/bin/python npm test
FORGE_PYTHON=/absolute/path/to/training-core/.venv/bin/python npm run demo
FORGE_PYTHON=/absolute/path/to/training-core/.venv/bin/python npm run research -- fixture
FORGE_PYTHON=/absolute/path/to/training-core/.venv/bin/python npm run research -- qwen
FORGE_PYTHON=/absolute/path/to/training-core/.venv/bin/python npm run research -- fixture-grpo
FORGE_PYTHON=/absolute/path/to/training-core/.venv/bin/python npm run research -- qwen-grpo \
  --start-adapter /absolute/path/to/approved/sft/checkpoint
```

Use the npm scripts: they run the pinned Bun 1.4.2. A different global Bun cannot read
the actors' persisted state (hydration fails with "Unable to deserialize data").

`test` and `demo` start a loopback Relaycast engine (`scripts/relay-server.mjs`, under
Node) and the native Terse runtime, create an offline random tiny GPT-2 fixture, and run
the full lifecycle with labeled fault injection: a lost send response, duplicate and
forged Relay copies, SIGKILL of both services, a worker crash after completion, a
duplicate work notification, and a message beyond the channel page. `demo` keeps its
output under ignored `artifacts/demo-<timestamp>/`, including `verification.json`.
The tiny model is not expected to improve; its score has no benchmark significance.

`research` runs an autonomous campaign under the director policy and writes
`research-report.json` and `ledger.json` under `artifacts/research-<profile>-<timestamp>/`.
While it runs it also writes `live/state.json` every 2 seconds: campaign, ledger,
workflow-outbox and experiment snapshots from public actor reads, which the research
dashboard (`apps/web/`) reads instead of connecting to actors.
`fixture` uses the offline tiny model (about 25 seconds). `qwen` prepares a pinned
GSM8K **train**-split partition (128 train, 16 development, 16 regression; the test
split is never read), freezes a Qwen2.5-0.5B-Instruct baseline and trains on Apple MPS; it needs the
model and dataset in the local Hugging Face cache and takes tens of minutes. Neither
profile provisions paid compute.

`fixture-grpo` runs the same campaign with method `grpo` on an offline tiny model
warm-started on the answer format (about 40 seconds); `--from-sft` first trains a short
SFT adapter on the campaign's own base model and continues it with GRPO. `qwen-grpo`
requires `--start-adapter <dir>`, an approved SFT checkpoint to continue: from the raw
instruct model about 1 in 32 sampled answers earns the reward, too little signal to
learn from. A campaign that continues an adapter evaluates that adapter as its frozen
baseline and regression reference, so promotion requires beating it. The Qwen profile
uses one completion per loss micro-batch and gradient checkpointing. Set
`PYTORCH_MPS_HIGH_WATERMARK_RATIO` (with a lower `PYTORCH_MPS_LOW_WATERMARK_RATIO`) to
cap Apple GPU memory so a job fails rather than swapping; both are passed to Python.

## Final evaluation (Phase 8)

```sh
FORGE_PYTHON=... FORGE_HARNESS_PYTHON=/absolute/path/to/harness/python \
  npm run research -- fixture-final --finalize
FORGE_HARNESS_PYTHON=... bun scripts/bundle.ts artifacts/research-fixture-final-<timestamp>
bun scripts/bundle.ts --verify <bundle>
FORGE_HARNESS_PYTHON=... bun scripts/bundle.ts --reproduce <bundle> --output <new-dir>
FORGE_HARNESS_PYTHON=... bun scripts/final-evaluate.ts <campaign-dir> --authority <evaluator-authority>
```

`FORGE_HARNESS_PYTHON` is an environment with training-core's `harness` extra
(EleutherAI lm-evaluation-harness 0.4.9.2; [HARNESS.md](../training-core/HARNESS.md));
it defaults to `FORGE_PYTHON`. After the research report is written, `--finalize`
(`src/finalize.ts`):

1. freezes the promoted checkpoint in `FinalEvaluationActor` (owner key; refused while the
   campaign is open, for anything but the promoted, approved checkpoint, and twice);
2. runs `forge-harness development`: starting policy and checkpoint, paired, in fresh
   processes under one frozen protocol on the development set;
3. runs `forge-harness freeze`, which re-verifies the training bundle, promotion,
   governance evidence and held-out regressions and packages the release, whose bundle
   hash the owner binds in the actor once;
4. rehearses the release on development data (`forge-final rehearse`), never a final claim;
5. records probes: a director freeze, a second freeze, a release swap, a research-role
   final record and a rehearsal overwrite are each refused, and a fixture release cannot
   obtain final test access.

`final/outcome.json` records each step; the dashboard shows it while it runs. The
fixture-final profile is an offline tiny model on a task SFT reliably learns (every answer
is 9), so a checkpoint is always promoted; it takes about a minute and is mechanics only.
For Qwen profiles the harness uses training-core's zero-shot chat protocol and local
limits from `services/training-core/examples/`.

`scripts/final-evaluate.ts` is the evaluator's side. It takes the evaluator's authority
(`forge-final init-authority`), checks that the release on disk is the bound one, obtains
the one-attempt grant, runs `forge-final evaluate` on the full pinned GSM8K test split,
and records the result with the final evaluator's key. It refuses fixture releases.
Locally it restarts the actor runtime on the campaign's journal with fresh keys, so it
rehearses the separation rather than enforcing it.

`scripts/bundle.ts` (`src/bundle.ts`) builds `final/bundle/` from stored files:
`claims.json` (every stated number with its artifact, JSON pointer and SHA-256),
`checks.json` (the Phase 8 gate checks and what each observed), the harness bundles and
release, `checkpoint.tar.gz`, campaign evidence, recordings and `SHA256SUMS`. Harness
bundles are re-verified with `forge-harness verify`. `--verify` checks a copy anywhere,
and `--reproduce` rehearses the copied release again and requires identical generations,
scores and comparison. `apps/web/scripts/record-campaign.ts` builds the bundle once the
recording it cites is complete.

## Components

| File | Responsibility |
| --- | --- |
| `src/relay.ts` | Registers role participants; sends unsent outbox messages with idempotency keys; recipients consume their Relay channel, verify sender, channel and exact bytes against the durable message, then acknowledge |
| `src/worker.ts` | Allowlisted training jobs; fenced lease renewed at a third of the campaign's `maxLeaseMs`; runs reuse the frozen baseline; GRPO jobs get a world gateway per lease generation; evidence checks of the Python run bundle and, for GRPO, of rewards against world journals with step replay; evaluator reproduction in a separate process |
| `src/worlds.ts` | World gateway: loopback endpoint with a per-job token; one data-role reset and one worker-role step per completion, in concurrent lanes, with request IDs that make retries replay receipts; `verifyWorldRollouts` checks a run's rewards against each world's journal |
| `src/evaluations.ts` | Untrained-model evaluations cached by campaign, experiment label, model, data and protocol; batched evaluation adopted only if it matches batch size 1 |
| `src/reconcile.ts` | Reports unsent, unacknowledged, unannounced-completion and expired-lease work from actor state; settles unmeasured local cost at the reserved bound |
| `src/director.ts` | Pure decision policy: diagnosis, two exploratory recipes, measured ranking, revision operator, stop rules |
| `src/recipes.ts` | Data role materializes a recipe (training subset and config) from the campaign template; reviewer recomputes and compares it |
| `src/governance.ts` | Reviewer: independent artifact, data, protocol and regression checks; preserved evidence bundle; terminal governance decision |
| `src/research.ts` | Message-driven campaign: each role reacts to Relay messages; director decides after a round's measurements are recorded; coordinator settles terminal reservations |
| `scripts/scenario.ts` | The Phase 3 fault-injection lifecycle used by `test` and `demo` |
| `scripts/research.ts` | Provisions a profile, freezes the baseline and runs a research campaign |
| `src/finalize.ts` | Phase 8 research side: actor freeze, development harness, release freeze and binding, rehearsal, refusal probes |
| `src/bundle.ts`, `scripts/bundle.ts` | Evidence bundle, claims, gate checks, copy verification and clean-copy reproduction |
| `scripts/final-evaluate.ts` | Phase 8 evaluator side: the one-attempt sealed run, recorded against the bound release |

## Evaluation cost

Development evaluation dominates campaign time, so the orchestrator avoids repeating it:

- **Frozen baseline reuse.** Each worker run receives the campaign's frozen untrained
  evaluation (`run --frozen-baseline`) instead of re-evaluating the base model; the
  training core accepts it only if model, data, samples and protocol match exactly.
- **Batched generation.** A profile may request `evaluation.batch_size` (Qwen: 8,
  fixture: 2). Before any training, the campaign compares the untrained model's batched
  predictions with batch size 1 and adopts the batch size only if every prediction is
  identical; otherwise the whole campaign uses batch size 1. The report records the
  requested and used sizes and the agreement count.
- **Cached untrained evaluations.** The frozen baseline, the batch-size-1 reference and
  the regression suite's untrained score are cached by key in `FORGE_EVALUATION_CACHE`
  (default for `npm run research`: ignored `artifacts/cache/evaluations/`). The key covers
  campaign, experiment label, model, data and protocol, including the training core's
  source hash, so code or data changes miss the cache. Cache entries are checked against
  their key before use. `runResearch()` called as a library uses no cache unless given one.
- **One model job per host.** Python model commands take the training core's host-wide
  lock (`FORGE_MODEL_LOCK`, `FORGE_MODEL_LOCK_TIMEOUT` pass through), so concurrent
  campaigns or agents queue instead of exhausting memory.

## Delivery semantics

The actor outbox is authoritative; Relay is transport. A sender posts each unsent
message with an idempotency key derived from campaign and message ID, then records the
Relay ID. Recipients read their channel (newest 100 messages) and fall back to the
recorded Relay ID for anything not on the page. Copies with the wrong sender, channel
or bytes are ignored; extra genuine copies are handled once. Handlers receive the
durable message and must be idempotent: a lost acknowledgement re-runs them, and every
actor command they issue uses a stable request ID.

The worker never optimizes a terminal experiment again. A completed run bundle from a
lost completion reply is verified and reported under a fresh lease. A partial run
directory from a crashed attempt is preserved and refused (`PARTIAL_RUN_DIRECTORY`).
Relay messages select allowlisted job IDs; they never carry commands or paths.

Retries must advance the actor's attempt state. Exhausted runtime or attempt limits
close an expired job as failed so the coordinator can settle its reservation. Errors
before a new attempt leave the message pending and propagate instead of spinning.
Recipe preparation verifies the source partition checksum, supports absolute and
relative template paths, and reuses identical files after an interrupted delivery;
conflicting files remain untouched.

## Research policy

`director-rules-v1` is deterministic; it makes no model calls. Proposals and decisions
pass through a structured interface, so a model-backed proposer could replace it,
while execution stays authorized by the deterministic checks below.

1. Diagnose the frozen baseline from its per-example diagnoses: truncation at the
   generation limit, invalid final-answer format, or wrong answers.
2. Explore two recipes through the campaign's `sft_lora` method: the full training
   partition, and the shorter half of solutions. The diagnosis orders them; both run
   if budget allows. (GRPO, the other campaign strategy, arrives in Phase 6.)
   A campaign whose method is `grpo` uses the same rules: its recipes select tasks
   from the same partition and train with world rewards on their answer-free projection.
3. Rank measured candidates by correct answers, then fewer format failures, then
   fewer truncations. Losers become rejected alternatives with measured reasons.
4. Revise the selected recipe according to what it measured: regression lowers the
   learning rate; predictions identical to baseline raise it; otherwise train for twice
   the steps. Each decision records what the other measurements would have chosen.
5. Stop on the first applicable rule: two failures, a revision that does not beat the
   prior best, two revisions, the experiment limit, the budget, or a revision outside
   policy limits.

Every decision cites ledger-verified evidence. Before any compute, the reviewer
requires the director's ledger launch, recomputes the recipe's data selection from the
allowed partition, and checks the validated config against the template, frozen
protocol and limits.

## Checkpoint governance

When the director stops, it sends the development-selected candidates (at most two, in
rank order) to the reviewer (`src/governance.ts`). The reviewer trusts no worker or
evaluator message. It:

- recomputes the checkpoint directory hash and evaluation report hash from the files
  and compares both with the experiment and registry records, and re-verifies the run
  manifest;
- re-derives the recipe's data selection from the allowed partition and compares it
  with the bytes the run actually staged and trained on; development data must be the
  frozen set;
- checks the evaluation report against the frozen protocol, dataset, counts and
  checkpoint;
- for GRPO candidates, re-reads every world journal: each recorded reward must be exactly
  one transition of this job, with the same reward, state and task (`REWARD_PROVENANCE`);
- checks for regressions: no development example the baseline answered may become
  wrong, and the candidate may not score below the untrained model on a held-out
  regression suite that no recipe can train on (`maxDropBps: 0`).

The reviewer writes an evidence bundle under `governance/`, then records a terminal
`GovernanceActor` decision citing the bundle's hash. An approved candidate is promoted
by the director, subject to the campaign's own improvement threshold. After a veto,
the director records a corrective ledger decision and reviews the next-ranked candidate.
A veto is final; no promotion path can override it.

`npm run research -- fixture --inject-tamper` is labeled failure injection: it alters
the first reviewed checkpoint after registration, to exercise the veto path.

## Trust and limits

This local harness holds every role's Relay token and Terse signing key in one process.
Deployed roles need separate processes and credentials. The world gateway in particular
holds the data role's key, the reward secret and the worker key in this process; a
deployment needs a separate trusted task service. Relay channels are routing,
not authorization. Recipients poll; Relay inbox acknowledgements and push subscriptions
are not used. Only the local Relaycast engine has been exercised, not a hosted Relay
workspace. Evaluator reproduction and governance review share host, code and process
with the worker, but use separate keys and re-derive facts from bytes rather than
messages. The final evaluator's authority, grant and sealed data belong to a separately
owned account in deployment; locally the same user holds everything. The
director's working state is in memory and is not resumed after a process crash; the
ledger keeps its record. Selecting among candidates on a small development set can
overfit it. See the
[Phase 3](../../docs/verification/phase3-local.md),
[Phase 4](../../docs/verification/phase4-local.md) and
[Phase 5](../../docs/verification/phase5-local.md),
[Phase 6](../../docs/verification/phase6-local.md) and
[Phase 8](../../docs/verification/phase8-local.md) verification records.
