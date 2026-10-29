# Forge durable coordination

Seven actors on **Terse `durable-actors@0.14.0`**, with real native runtime integration
tests. Phase 2 built five; Phase 3 added `ResearchWorkflowActor`, the durable outbox
that `services/orchestrator/` delivers through Agent Relay; Phase 4 added
`ResearchLedgerActor`, the evidence-checked record of research decisions. Since
Phase 6 the mathematical worlds produce the only rewards of GRPO training, through the
orchestrator's world gateway (`services/orchestrator/src/worlds.ts`).

## Run

Requires Node/npm for installation and a supported native Terse platform (macOS
arm64/x64 or Linux arm64/x64). Dependencies include the pinned Bun 1.4.2 executable;
use npm scripts so a different global Bun cannot silently serialize incompatible
actor state. Initial runtime startup downloads the matching Terse native release
and verifies its checksum. No paid service credentials are needed.

```sh
cd packages/terse-actors
npm ci
npm run check
npm run format:check
npm run generate
npm test
npm run demo
```

`generate` produces seven SDK contracts under ignored `artifacts/generated/`.
`test` starts an actual native server, calls its HTTP RPC API, kills it with SIGKILL,
and restarts against the same persistent directory. Tests run serially; each
test file is an ordered lifecycle scenario. The demo reserves a budget,
scores a hand-authored math answer, crashes/restarts, replays the answer, and aborts
and settles unused compute. Its JSON explicitly labels it a coordination fixture:
no optimizer runs and no model gain is claimed. Temporary state is deleted on
normal exit. No signing keys or server secrets are printed.

## Actors

| Actor | Authority and behavior |
| --- | --- |
| `ResearchCampaignActor` | Immutable specification and baseline; allowed proposals; atomic micro-USD reservations and concurrency cap; terminal cost settlement; evidence-gated best checkpoint promotion |
| `ExperimentActor` | Authenticated reservation grant; immutable configuration; expiring worker leases with monotonically increasing generations; bounded retries; terminal checkpoint and development evaluation records |
| `GovernanceActor` | Immutable objective/policy binding; separately signed, terminal approval or rejection for each checkpoint hash |
| `ArtifactRegistryActor` | Immutable checksum, URI, provenance and size references, with role restrictions on artifact kinds |
| `RLWorldActor` | Deterministic decimal answer scoring, integer calculator, versioned actions, duplicate receipts, bounded trajectories and snapshot forks |
| `ResearchWorkflowActor` | Durable outbox with fixed role routes and causal order; Relay delivery receipts and recipient acknowledgements; terminal preflight reviews; one training assignment per experiment, required by `acquireLease` when the campaign sets `requirePreflight` |
| `ResearchLedgerActor` | Director-only, append-only diagnoses, hypotheses, decisions and stop rules; verifies cited baseline, evaluation and failure evidence against actor state; one launching decision per experiment; closed by a stop entry |

[The integration contract](../../docs/actor-contract.md) describes permissions,
recovery and next-phase responsibilities. `src/contracts.ts` contains strict Zod
schemas. Use `src/client.ts` from a trusted backend to sign and invoke commands.
Use `scripts/local-runtime.ts` only for local development and serial tests; `launch`
can restart a runtime on its previous port so existing clients reconnect.

## Trust and limits

Every mutation requires an Ed25519 signature bound to project, campaign, actor,
method, payload, request ID and expiration. Trusted server configuration maps
public keys to roles and campaign scopes. Worker, evaluator and reviewer private
keys belong in separate processes in a deployed system. The local test harness
holds all role keys solely to exercise these boundaries.

The actor environment requires `FORGE_ACTOR_PROJECT_ID`, `FORGE_ACTOR_PUBLIC_KEYS`
(a JSON key registry), `FORGE_ACTOR_TRANSPORT_KEY`, `FORGE_COORDINATION_SECRET` and
`FORGE_REWARD_SECRET`. Both secrets are 64 lowercase hex characters. The launcher
supplies these explicitly and strips unrelated inherited credentials. Terse sets
`DURABLE_ACTORS_CONTROL_PLANE_URL` for internal reads. Preserve server secrets and
identity configuration across restarts; losing the reservation key makes existing
grants unverifiable. Production provisioning/rotation is not implemented here.

The native development server is loopback-only, with observability endpoints that
are not a tenant security boundary. Do not expose it publicly. Public actor metadata
reads rely on the backend transport credential; signed mutation permissions are
additional restrictions. Infrastructure administrators can inspect actor storage.

Artifact hashes, evaluator counts, reviewer checks and cost evidence are signed
**attestations**, not automatic verification of file bytes, benchmark execution,
provider spend or regression results. Promotion cross-checks those records and the
frozen baseline, but Phase 5 must establish independent evidence acquisition and
verification. Decisions are terminal; ongoing revocation after promotion remains
future work. Stopping a campaign blocks new work; the coordinator must abort active
experiments and stop external compute before settling them.

Each actor's event journal and idempotency receipts are rows in its Terse SQLite
database (`forge_events`, `forge_receipts`), written in the same transaction as its
`@Persisted` domain state. Terse rewrites and re-reads persisted fields whole on every
invocation, so keeping these append-only logs out of them makes command cost
independent of history: lease renewal stays at about 16–20 ms after 2,750 entries,
where it previously grew to 114 ms. Local data directories created before this
change are not compatible.

Domain state is still bounded (1,000,000 journal entries per actor, 4,000 registry
artifacts, 1,000 ledger entries, 2,000 workflow messages, 1,000 world episodes, 32
snapshots, 32 steps per episode) and still rewritten whole on change, so large outboxes
and registries grow command cost. Plan new actors before exhausting capacity.
Production backups, cancellation of external workers, live billing, sealed evaluation,
and resumable optimization remain separate integrations. This package never stores
model weights in actor state.
