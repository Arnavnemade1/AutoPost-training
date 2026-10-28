# Forge orchestrator

Durable Terse outbox messages travel over **Agent Relay** (`@agent-relay/sdk@14.0.0`)
between director, data researcher, reviewer, coordinator, worker and evaluator roles
(Phase 3). A worker adapter runs the Phase 1 Python trainer only for a Relay-delivered,
preflight-approved assignment that matches a local job allowlist. A deterministic
research director chooses each experiment from measured development results and
records its reasoning in the Terse research ledger (Phase 4).

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
```

`test` and `demo` start a loopback Relaycast engine (`scripts/relay-server.mjs`, under
Node) and the native Terse runtime, create an offline random tiny GPT-2 fixture, and run
the full lifecycle with labeled fault injection: a lost send response, duplicate and
forged Relay copies, SIGKILL of both services, a worker crash after completion, a
duplicate work notification, and a message beyond the channel page. `demo` keeps its
output under ignored `artifacts/demo-<timestamp>/`, including `verification.json`.
The tiny model is not expected to improve; its score has no benchmark significance.

`research` runs an autonomous campaign under the director policy and writes
`research-report.json` and `ledger.json` under `artifacts/research-<profile>-<timestamp>/`.
`fixture` uses the offline tiny model (about 25 seconds). `qwen` prepares a pinned
GSM8K **train**-split partition (128 train, 16 development; the test split is never
read), freezes a Qwen2.5-0.5B-Instruct baseline and trains on Apple MPS; it needs the
model and dataset in the local Hugging Face cache and takes tens of minutes. Neither
profile provisions paid compute.

## Components

| File | Responsibility |
| --- | --- |
| `src/relay.ts` | Registers role participants; sends unsent outbox messages with idempotency keys; recipients consume their Relay channel, verify sender, channel and exact bytes against the durable message, then acknowledge |
| `src/worker.ts` | Allowlisted training jobs; fenced lease with heartbeats; evidence checks of the Python run bundle; evaluator reproduction in a separate process |
| `src/reconcile.ts` | Reports unsent, unacknowledged, unannounced-completion and expired-lease work from actor state; settles unmeasured local cost at the reserved bound |
| `src/director.ts` | Pure decision policy: diagnosis, two exploratory recipes, measured ranking, revision operator, stop rules |
| `src/recipes.ts` | Data role materializes a recipe (training subset and config) from the campaign template; reviewer recomputes and compares it |
| `src/research.ts` | Message-driven campaign: each role reacts to Relay messages; director decides after a round's measurements are recorded; coordinator settles terminal reservations |
| `scripts/scenario.ts` | The Phase 3 fault-injection lifecycle used by `test` and `demo` |
| `scripts/research.ts` | Provisions a profile, freezes the baseline and runs a research campaign |

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
protocol and limits. Checkpoint governance is deferred to Phase 5: no terminal
governance decision is recorded, so no checkpoint is promoted.

## Trust and limits

This local harness holds every role's Relay token and Terse signing key in one process.
Deployed roles need separate processes and credentials. Relay channels are routing,
not authorization. Recipients poll; Relay inbox acknowledgements and push subscriptions
are not used. Only the local Relaycast engine has been exercised, not a hosted Relay
workspace. Evaluator reproduction shares host and code with the worker; independent
evaluation is Phase 5. The director's working state is in memory and is not resumed
after a process crash; the ledger keeps its record. Selecting among candidates on a
small development set can overfit it. See the
[Phase 3](../../docs/verification/phase3-local.md) and
[Phase 4](../../docs/verification/phase4-local.md) verification records.
