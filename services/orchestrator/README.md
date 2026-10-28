# Forge orchestrator

Phase 3 dispatch: durable Terse outbox messages travel over **Agent Relay**
(`@agent-relay/sdk@14.0.0`) between director, data researcher, reviewer, coordinator,
worker and evaluator roles. A worker adapter runs the Phase 1 Python trainer only for
a Relay-delivered, preflight-approved assignment that matches a local job allowlist.
Role decisions are scripted handlers; evidence-driven selection is Phase 4.

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
```

`test` and `demo` start a loopback Relaycast engine (`scripts/relay-server.mjs`, under
Node) and the native Terse runtime, create an offline random tiny GPT-2 fixture, and run
the full lifecycle with labeled fault injection: a lost send response, duplicate and
forged Relay copies, SIGKILL of both services, a worker crash after completion, a
duplicate work notification, and a message beyond the channel page. `demo` keeps its
output under ignored `artifacts/demo-<timestamp>/`, including `verification.json`.
The tiny model is not expected to improve; its score has no benchmark significance.

## Components

| File | Responsibility |
| --- | --- |
| `src/relay.ts` | Registers role participants; sends unsent outbox messages with idempotency keys; recipients consume their Relay channel, verify sender, channel and exact bytes against the durable message, then acknowledge |
| `src/worker.ts` | Allowlisted training jobs; fenced lease with heartbeats; evidence checks of the Python run bundle; evaluator reproduction in a separate process |
| `src/reconcile.ts` | Reports unsent, unacknowledged, unannounced-completion and expired-lease work from actor state; settles unmeasured local cost at the reserved bound |
| `scripts/scenario.ts` | The end-to-end lifecycle used by `test` and `demo` |

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

## Trust and limits

This local harness holds every role's Relay token and Terse signing key in one process.
Deployed roles need separate processes and credentials. Relay channels are routing,
not authorization. Recipients poll; Relay inbox acknowledgements and push subscriptions
are not used. Only the local Relaycast engine has been exercised, not a hosted Relay
workspace. Evaluator reproduction shares host and code with the worker; independent
evaluation is Phase 5. See [Phase 3 verification](../../docs/verification/phase3-local.md).
