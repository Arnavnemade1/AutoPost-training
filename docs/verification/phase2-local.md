# Phase 2 local verification

Verified on macOS arm64. This record concerns durable coordination,
not a trained model's accuracy. Phase 1's separate real Qwen training result remains
0/8 to 0/8 on its tiny development diagnostic.

## Runtime and source

- Actual npm `durable-actors@0.14.0`, pinned in `package-lock.json`, with matching
  downloaded native runtime and SDK checksum verification.
- Actual Bun 1.4.2, installed locally through the pinned npm dependency.
- Official upstream source inspected at
  [`0eca91adf5888cfa244f842f978eb47c19851158`](https://github.com/TerseAI/durable-actors/tree/0eca91adf5888cfa244f842f978eb47c19851158),
  including SDK decorators, actor state, backend transport and native local launcher.
- A first live probe failed hydration because the native process found an older
  globally installed Bun. The launcher now explicitly puts the package-local Bun
  executable on PATH. The successful tests use the same pinned Bun for generation,
  startup and actor hosting.

## Executed checks

From `packages/terse-actors/`:

| Command | Observed result |
| --- | --- |
| `npm run check` | TypeScript strict typecheck passed |
| `npm run format:check` | Prettier formatting passed |
| `npm run generate` | Compiled five real actor contracts |
| `npm test` | 13 tests passed, 102 assertions, zero failures; 12.32 seconds on recorded run |
| `npm run demo` | Real RPC, forced restart, duplicate action recovery and unused reservation settlement succeeded |

Ten integration scenarios use the real native runtime and HTTP RPC. Three unit
checks cover exact numeric normalization, canonical hashing and strict schemas.
There are no mocked actor implementations. Integration tests are serial stages of
an intentionally ordered lifecycle; avoid running individual stages in isolation.

Verified behaviors:

- Role, campaign scope, signature and request expiration checks; immutable objectives;
  retry receipts and conflicting request IDs.
- Ten simultaneous reservations accept exactly two within a 200 micro-USD fixture
  budget; rejected writes do not advance state. A separate ample-budget case rejects
  a second reservation solely because of the concurrency cap.
- Tampered grants cannot initialize work; expired and superseded leases cannot renew
  or complete; active leases exclude competitors; bounded retries terminate.
- Evaluation before completion fails. Promotion before settlement, approval or artifact
  registration fails. Both artifact/review arrival orders work when evidence is complete.
- Approved synthetic evidence can promote once. Terminal rejection cannot be replaced
  or promoted. Even reviewer approval cannot override a mismatching frozen protocol.
- Exact math scoring, concurrent/stale actions, wrong answers, truncation, action
  deduplication, observation isolation, snapshot forks and stale episode rejection.
- SIGKILL of the native runtime followed by restart with the same persisted data and
  authority preserves campaign state, reservations, lease generations, governance veto,
  trajectories and request receipts. Retried rewards do not add trajectory entries.
- An unused grant can be terminally aborted, settled and never reinitialized. Stop
  prevents new work. Committed event sequences are contiguous per actor.

The standalone demo uses a hand-authored `6 + 7` answer. It ends with exactly one
reward-bearing transition, zero spent/reserved cost, no best checkpoint, and explicit
`trainingExecuted: false` / `modelImprovementClaimed: false` output. Its score is an
environment mechanics check, not a policy or model benchmark.

## Scope and remaining gates

This is a local runtime verification. Remote Terse deployment, production isolation,
secret provisioning/rotation, billing reconciliation, worker cancellation and backups
have not been verified. The local test harness holds all test identities; deployed
reviewer and worker processes must not share signing keys.

Artifact registration and reviewer checks are attestations. Actual file-content
verification, benchmark reproduction and independent regression execution are Phase 5
work. Governance decisions here are terminal; post-promotion revocation is not yet
implemented. Provider costs are coordinator-reported bounded integers, not measured
billing. Relay dispatch, Python worker execution and reward-driven optimization are
not connected to these actors yet.

Phase 1 GitHub CI passed in
[run 40634515058](https://github.com/Arnavnemade1/AutoPost-training/actions/runs/40634515058).
Phase 2's `.github/workflows/terse-actors.yml` runs typecheck, formatting, contract
generation, native integration tests and the demo on Linux. Its remote result is
not included in this local verification record.
