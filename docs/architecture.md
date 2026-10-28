# Forge architecture

The system separates research decisions, authoritative state, compute, and independent
verification. The training core, durable actors and Relay dispatch to the worker are
implemented and tested locally. This is the target architecture; autonomous research
selection, independent evidence verification and the UI remain future integrations.

```mermaid
flowchart TD
    U[Human: objective, model, benchmark, budget] --> C
    C[Terse campaign actor: immutable objective and atomic budgets]
    D[Research director] <--> R[Agent Relay: structured assignments and findings]
    R <--> S[SFT, RL, data, and evaluation researchers]
    R <--> G[Independent governance reviewer]
    D --> C
    S --> E[Terse experiment actor: proposal, lease, lifecycle]
    G --> V[Terse governance actor: policy, vetoes, approvals]
    C --> E
    V --> E
    E --> W[Scoped GPU worker: LoRA / future GRPO]
    W <--> M[Terse math worlds: canonical transitions and rewards]
    W --> A[Immutable artifact storage and registry]
    A --> Q[Independent development evaluator]
    Q --> V
    Q --> R
    V --> P[Atomic authorized checkpoint promotion]
    P --> C
    C --> F[Freeze selected checkpoint]
    F --> T[Separately permissioned sealed final evaluator]
    T --> O[Final report and reproducibility bundle]
    C --> UI[Dashboard: real events and artifacts]
    A --> UI
    R --> UI
    UI --> REC[Real screen recording and accelerated exports]
```

## Directory and runtime boundaries

| Boundary | Location | Responsibility |
| --- | --- | --- |
| Training worker | `services/training-core/` | Implemented Python package; pinned models/data, bounded SFT LoRA, development diagnostics, real metrics, artifacts |
| Research orchestration | `services/orchestrator/` | Implemented Relay transport, durable dispatch/reconciliation and worker adapter; typed director/strategy calls planned |
| Authoritative state | `packages/terse-actors/` | Implemented Terse campaign, experiment, governance, math-world, registry and workflow-outbox actors; [integration contract](actor-contract.md) |
| Common contracts | `packages/contracts/` (planned) | Versioned actor/message/event schemas; consume worker-generated JSON Schema |
| Independent evaluation | `services/evaluator/` (planned) | Established benchmark harness, regression suite, protected final evaluation |
| Research interface | `apps/web/` (planned) | Research graph, metrics, environments, artifacts, governance, recording state |
| Capture/export | `scripts/record/`, `scripts/render-video/` (planned) | Faithful source recording, playable accelerated exports, recording manifests |

## Agent synchronization

Use durable records for work and Relay for communication. Every assignment/proposal/
result carries campaign ID, experiment ID, message ID, causation ID, schema version,
and artifact references. Persist a state transition and its dispatch intent together;
send/retry from an outbox, acknowledge receipt, and reconcile against authoritative
experiment status. A sent message does not prove a job started or finished.

The director chooses proposals using development evidence and declared stopping
rules. Workers accept immutable, validated specs only after proposal approval and
an atomic compute reservation. Worker leases use a generation/fencing token so a
stale worker cannot complete or charge a superseded attempt. Completion is idempotent.
Strategy changes create new experiments rather than mutating a running job.

Phase 2 implements signed role-scoped commands, durable receipts and events, and
authenticated reservation grants. Phase 3 adds the workflow outbox, Relay delivery
with reconciliation, a preflight gate on worker leases, and actual worker execution. Campaign RPC reads experiment, registry and governance
state; those actors never call back into campaigns. Promotion uses immutable
terminal records to avoid cross-actor evidence changing during its validation.

Reserve money in integer micro-USD to avoid floating-point accounting. Reservation,
release/finalization, concurrency caps, and official checkpoint promotion must serialize
through the campaign authority. Provider spending limits remain an external backstop.
Do not make the Python worker an alternative budget or promotion authority.

## Independence and evidence

Research identities cannot modify objectives, governance policy or approval records,
read final answers, replace evaluation binaries, or create official promotions.
Reviewers and the final evaluator use separate credentials. Deterministic authorization
checks enforce critical gates; LLM reviewers supplement them. Checksums establish
artifact identity, while separately trusted records/signatures establish authority.

Promotion requires a complete artifact manifest, exact checkpoint identity, reproducible
development evaluation, required regression checks, provenance, and independent
approval tied to that hash. Invalid candidates remain visible with rejection evidence.
Freeze the candidate using development evidence before the separately authorized final
benchmark. Never feed final scores back into checkpoint selection.

## Recovery and observability

Every significant action produces a correlated event with a timestamp. The dashboard
reads persisted artifacts/events; it must not manufacture metrics or agent activity.
Checkpoint files and datasets live outside actor state. Recovery reconciles worker
leases, object-store completion, actor status, reserved compute, and message acks.
Terse durability alone does not resume GPU optimization; training checkpoint/resume
support needs its own tested implementation.

Test completion before subscription, partial artifact upload, duplicate result,
review before/after artifact registration, concurrent reservations, actor restart,
Relay reconnect, expired worker lease, failed recording, and budget exhaustion.
Surface failures and preserve evidence. A completed worker run is an unreviewed
candidate, never an automatically approved model improvement.
