# Actor integration contract

The implementation is `packages/terse-actors/`. Schemas in `src/contracts.ts` and
actual RPC scenarios in `tests/integration.test.ts` and `tests/workflow.test.ts` are
executable references.
All write methods use Terse `@Atomic`, and every mutation assigns a new persisted
state value. Failed commands do not advance events, receipts, budgets or versions.
Actors do not opt into interleaved execution.

## Identity and request envelope

Use campaign ID as the campaign, governance, registry and workflow actor ID. Create experiment
and world IDs using `scopedId("exp" | "world", campaignId, label)` from `src/core.ts`.
This binds resource namespaces to campaigns even when labels are reused. IDs contain
only letters, digits, dots, underscores and hyphens. Labels are at most 40 characters.

`ForgeActorClient.command(actorName, actorId, campaignId, method, payload, requestId)`
signs a version-1 envelope and calls the real backend transport. A request is bound
to project, destination, campaign, key ID, method and payload, with a maximum five
minute validity window. Key roles/scopes come from the server, never from the caller.

| Role | Commands |
| --- | --- |
| owner | Initialize immutable campaign and governance policy; stop campaign |
| director | Propose allowed experiments; reserve; promote; stop; read worlds |
| coordinator | Reserve; initialize/abort experiment; settle; promote |
| worker | Acquire/renew lease; complete or report failure; register checkpoints/trajectories/reports; step/read worlds |
| evaluator | Record development evaluation; register evaluations/reports |
| reviewer | Record terminal governance decisions |
| data | Register datasets; reset/snapshot/restore/read worlds |

Private keys stay in the issuing service. A fresh signature with the same request
ID and operation returns the original successful receipt even after a restart.
Changing payload, destination or identity with that ID fails. Failed operations do
not consume IDs. Retries after expiration must be freshly signed. Successful read
methods do not add journal entries. Clients must persist stable request/action IDs
before dispatch; automatic generation is convenient for interactive use only.

## Experiment lifecycle and recovery

1. Owner initializes campaign with frozen model revision, development baseline,
   allowed strategies, policy version, budget and limits. Initialize governance with
   the returned objective hash and matching policy version.
2. Director proposes an immutable experiment. Campaign validates model, strategy,
   development dataset and experiment namespace.
3. Director/coordinator reserves compute. The campaign atomically checks spent plus
   reserved cost and active slots, then persists and returns an HMAC-authenticated
   reservation grant. Read the campaign snapshot or retry to recover a lost reply.
4. Coordinator initializes the experiment with that grant. A reservation exists
   before work can start. Worker acquires a lease and receives generation/expiry.
5. Worker renews before expiry and includes the current generation when reporting
   completion/failure. Superseded or expired generations cannot mutate the result.
   Every acquisition consumes an attempt; renewals do not. Overall runtime and
   attempt limits are bounded by the grant. The process doing actual compute must
   stop when it loses its lease; fencing prevents acceptance, not GPU execution.
6. Completion records checkpoint/config/manifest hashes and `weightsChanged: true`.
   An evaluator records immutable development evidence only after completion.
   Artifacts can arrive before or after results/reviews; retry promotion when complete.
7. Coordinator settles an experiment only when the actor is completed, evaluated or
   failed and its grant matches. Actual micro-USD cost cannot exceed its reservation.
   Overruns require provider-level controls and reconciliation outside this package.
8. For abandoned work, coordinator aborts using the original grant (including if
   initialization never happened), then settles. Abort consumes the experiment ID
   permanently, so the old grant cannot later launch work after budget release.

A worker failure becomes retryable until its attempt cap, then failed. A worker
that disappears stays running with an expired lease until reacquired or aborted;
Phase 3 reconciliation reports it as an expired lease. Retry/runtime exhaustion can be
recovered by coordinator abort and settlement. No reservation releases itself on a timeout.
This prevents delayed workers from spending a released reservation.

Campaign-to-experiment/governance/registry reads are acyclic. Experiments validate
reservation grants locally and do not call back into campaigns, avoiding reciprocal
actor waits. Model training and file uploads run outside actor RPC transactions.

## Promotion

The campaign is the sole best-checkpoint authority. It requires:

- A settled reservation and matching experiment/configuration with completed training
  and a development evaluation of the same checkpoint.
- A terminal approval by the reviewer, bound to exact objective, policy, experiment,
  checkpoint and evaluation hashes. Rejections cannot be rewritten into approvals.
- Immutable checkpoint/evaluation registry entries with matching kinds and hashes.
- Exactly the frozen dataset, baseline report, evaluation protocol and sample counts.
- Improvement over baseline by the configured basis-point threshold and strict
  improvement over the previously approved best.

Checks are deterministic, but the evidence is attested by authorized services.
Registering a checksum does not read a file or reproduce a benchmark. Independent
file verification, regression execution, final-evaluation permissions and review
revocation belong to Phase 5. The Phase 2 tests use explicitly synthetic evidence;
they are not training performance evidence.

## Mathematical worlds

The trusted data service resets a world with task ID/version, seed, question,
`exact-numeric-v1` reward version and an HMAC answer commitment. The plaintext answer
never enters world RPC arguments/state or returned observations. Use `rewardCommitment`
with the same scoped values and server reward secret in the trusted task service.
This hides stored answers from ordinary clients; it is not protection against an
administrator or against a policy solving the public question.

A step supplies episode ID, action ID, expected state version and either a bounded
integer calculation or submitted decimal answer. Exact decimal normalization avoids
floating-point equality errors. A final answer terminates with reward 0 or 1; reaching
the step bound truncates. Unknown/stale episodes and versions fail explicitly.

Duplicate action/request IDs return the original transition with `replayed: true`,
without a second trajectory entry. Consumers must deduplicate rewards by
`(episodeId, actionId)`; response replay is not exactly-once downstream consumption.
Snapshots restore into a fresh episode with parent lineage, copied trajectory prefix,
and a new state version. Use fresh action IDs in a fork. Never count inherited
trajectory entries as newly earned rewards. Tasks and snapshots can only be changed
by the data role. Current worlds are not connected to a GRPO optimizer.

## Workflow outbox and preflight (Phase 3)

`ResearchWorkflowActor` persists every inter-role message before transport. A queued
message has a campaign-unique, immutable message ID, a causal `sequence`, the sender's
key ID, and a fixed route. Routes are not caller-selected:

| Kind | Sender → recipient | Created by |
| --- | --- | --- |
| `RESEARCH_ASSIGNMENT`, `CORRECTION` | director → data | `publish` |
| `EXPERIMENT_PROPOSAL` | data → director | `publish` |
| `REVIEW_REQUEST` | director → reviewer | `publish` |
| `PREFLIGHT_REVIEWED` | reviewer → coordinator | `review` (terminal per experiment) |
| `TRAINING_ASSIGNMENT` | coordinator → worker | `assign` (one per experiment) |
| `TRAINING_COMPLETED` | worker → evaluator | `publish` |
| `EVALUATION_COMPLETED` | evaluator → reviewer | `publish` |
| `CHECKPOINT_REVIEWED` | reviewer → director | `publish` |

`assign` requires a valid reservation grant and an approved preflight review bound to
the grant's configuration hash. A campaign initialized with `requirePreflight: true`
issues grants that make `acquireLease` read `getAuthorization` from the workflow actor:
a worker cannot claim compute until a matching approved assignment exists. Experiment
reads workflow; workflow never calls other actors, so actor reads remain acyclic.

Only the coordinator records `markSent` with a Relay message ID; a different ID for
the same message fails with `DELIVERY_CONFLICT`. Only the recipient role acknowledges,
and only after a send is recorded. A sent or acknowledged message is not evidence
that work happened: recipients verify the experiment, registry and run artifacts.
The outbox holds at most 2,000 messages per campaign.

## Events and integration

`getEvents(afterSequence, limit)` reads up to 100 committed events; sequences start
at 1, monotonically increasing per actor. Every event has a stable event ID,
campaign/actor IDs, sequence, timestamp, type and payload. There is no global event
ordering. Poll/reconcile from persisted cursors and deduplicate by event ID.

`services/orchestrator/` sends outbox messages through Agent Relay and reconciles
them; see its README and the [Phase 3 verification](verification/phase3-local.md).
Its worker adapter translates Phase 1 Python evidence into these actor schemas from
stored artifact bytes and hashes, never from console text. A reservation is not a
launch, an RPC reply is not a training result, and a Relay message is not authoritative
state. Reconcile from stored actor status after lost messages, worker restarts and
late artifact arrival.
