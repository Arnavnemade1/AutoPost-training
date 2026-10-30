# Phase 3 local verification

Verified on macOS arm64. This record concerns synchronized dispatch
and recovery, not a trained model's accuracy. The tiny fixture model scored 0/2 before
and after optimization; no improvement is claimed. Role decisions are scripted
handlers, so this is not autonomous research (Phase 4).

## Runtime and source

- npm `@agent-relay/sdk@14.0.0` ([source](https://github.com/AgentWorkforce/relay)),
  pinned in `services/orchestrator/package-lock.json`. TypeScript strict checks run
  against its installed declarations rather than documentation examples.
- npm `@relaycast/engine@12.0.0` ([source](https://github.com/AgentWorkforce/relaycast))
  served on loopback by `scripts/relay-server.mjs`, persisting to SQLite. Node 24.13
  hosts it because its SQLite addon is not a Bun addon. Its channel history is
  listed newest-first (`messages.id DESC` in the engine), which the page-miss fault relies on.
- Terse `durable-actors@0.14.0` and Bun 1.4.2, as recorded in Phase 2.
- Python 3.11 training worker from `services/training-core/` (Torch 2.9.0,
  Transformers 4.57.1, PEFT 0.17.1), CPU, offline.

No hosted Relay workspace, Relay cloud credentials, remote Terse deployment or paid
compute was used.

## Executed checks

| Location | Command | Observed result |
| --- | --- | --- |
| `packages/terse-actors/` | `npm run check`, `npm run format:check` | Passed |
| `packages/terse-actors/` | `npm run generate` | Compiled six actor contracts |
| `packages/terse-actors/` | `npm test` | 17 tests passed, 139 assertions; 26.1 seconds |
| `services/orchestrator/` | `npm run check`, `npm run format:check` | Passed |
| `services/orchestrator/` | `FORGE_PYTHON=… npm test` | 4 tests passed, 25 assertions; 28.7 seconds |
| `services/orchestrator/` | `FORGE_PYTHON=… npm run demo` | Wrote `verification.json` with the values below |

The four new workflow-actor tests use the real native runtime: fixed sender/recipient
routes, immutable message IDs, coordinator-only delivery receipts, recipient-only
acknowledgement, terminal preflight reviews, one assignment per experiment, tampered
grants, and a SIGKILL restart preserving outbox order, reviews and leases.

## Gate evidence

The end-to-end scenario runs real Relaycast, real Terse and real Python optimization
in one lifecycle: research assignment → proposal → preflight request → reservation →
independent preflight approval → training assignment → training → reproduced
evaluation → governance rejection → director correction → settlement.

| Gate | Observed |
| --- | --- |
| A Relay assignment causes authorized work | Worker acquired compute only after it consumed the assignment from its Relay channel (`viaRelay: 1`). A lease attempt before preflight approval failed with `PREFLIGHT_REQUIRED`. |
| Duplicate messages cause one job | A duplicate genuine Relay copy and a direct duplicate notification produced 1 worker attempt, 1 `TRAINING_STARTED` event and 1 `TRAINING_COMPLETED` message. A forged copy from the wrong sender with an altered job ID was rejected before any handler ran (`rejectedCopies: 1`). A resend after a lost send response produced one Relay post. |
| Early completion remains discoverable | After an injected crash between the actor's `complete` and the announcement, reconciliation reported the experiment as an unannounced completion with an unacknowledged assignment. Redelivery reused the stored bundle without optimizing again. |
| Reconnect recovers pending work | After SIGKILL of both Relaycast and Terse, participants reconnected with their stored tokens; reconciliation reported the assignment pending, and the worker received it from Relay history. A message pushed off a one-message channel page was recovered by its recorded Relay ID (`viaReconciliation: 1`). |

Additional observed results:

- All nine workflow messages were sent and acknowledged in causal sequence order;
  final reconciliation found no unsent, unacknowledged, unannounced or expired work.
- The evaluator reloaded the checkpoint in a separate process and reproduced the
  worker's predictions exactly before recording the evaluation (0/2 baseline, 0/2
  candidate, 2 examples). Its own report is the registered evaluation artifact.
- The reviewer recorded a terminal rejection (`MECHANICS_ONLY`, `REGRESSIONS_NOT_RUN`);
  promotion then failed with `GOVERNANCE_VETO`. No best checkpoint exists.
- Reserved compute was settled: 0 micro-USD reserved, 100,000 spent. The charge is the
  reserved upper bound, labeled unmeasured; the local process has no provider bill.

## Limits and remaining work

- One orchestrator process holds every role's Relay token and Terse signing key. A
  deployment must separate them by process and credential, as Phase 2 requires.
- Relay channels are transport routing, not authorization. Authority comes from actor
  routes and signatures; recipients act on the durable copy, never on Relay text.
- Recipients poll channel history; they do not use Relay inbox acknowledgements or
  push subscriptions. Pages beyond 100 messages fall back to recorded Relay IDs.
- The evaluator reproduces on the same host and code as the worker. Independent
  evaluation infrastructure, file-content verification and regression suites are Phase 5.
- A crash during optimization leaves a partial run directory, which the worker refuses
  to reuse (`PARTIAL_RUN_DIRECTORY`). The attempt fails explicitly; resumable training is
  not implemented. The worker still needs external cancellation when it loses its lease.
- Reconciliation reports expired leases, but no coordinator policy yet reassigns or
  aborts them automatically.
- `.github/workflows/orchestrator.yml` installs the CPU worker and runs these tests on
  Linux. Its remote result is not part of this local record.
