# Forge implementation phases

Source: user-supplied PRD v1.0. This is an implementation plan,
not a statement that the full product or model improvement has been demonstrated.

## Success measure

Forge should autonomously improve a **specified baseline model on a specified
capability**, subject to compute, provenance, regression, and governance constraints.
Beating arbitrary existing models is an aspiration, not an acceptance criterion we
can promise. Report the named baseline, frozen evaluation settings, sample counts,
uncertainty, and limitations. A valid campaign can conclude **no improvement found**.

## Current status through Phase 8 implementation

- Phase 0: model/data revisions and local training runtime verified; live sponsor
  infrastructure, GPU-provider billing, final-evaluation permissions, and event rules pending.
- Phase 1: working LoRA worker, independent reload/evaluation, preserved evidence,
  35 passing tests, lint/format checks, and dependency checks. A real four-step Qwen
  run succeeded mechanically but showed no development improvement (0/8 to 0/8).
- Phase 2: five real Terse actors, signed roles, serialized budgets, fenced worker
  leases, evidence-gated promotion and deterministic math worlds. Native RPC and
  forced crash/restart verified with 13 tests and a runnable coordination demo.
- Phase 3: a sixth Terse actor holds the durable outbox and preflight gate; real Agent
  Relay messages (SDK 14.0.0, local Relaycast engine 12.0.0) dispatch scripted role
  handlers that drive real tiny-model optimization. Duplicate, forged, lost and
  post-crash deliveries plus Relay/Terse SIGKILL restarts are verified locally (17 actor
  tests, 4 end-to-end orchestrator tests).
- Phase 4: a deterministic director and a seventh actor, the evidence-checked research
  ledger. A real Qwen2.5-0.5B campaign chose each next experiment from measured
  development results with no human selection: 0/16 baseline, then 3/16 and 4/16,
  then 6/16 for the selected recipe; a further revision scored 4/16 and stopped it.
  This is a 16-example custom-scorer diagnostic, not a benchmark result.
- Phase 5: an independent reviewer re-derives artifact hashes, data access, protocol and
  regressions from bytes before a terminal, evidence-bound decision. A labeled injected
  tamper was vetoed, both promotion paths refused it, and the director fell back to the
  next candidate. In the real Qwen campaign the selected candidate passed every check
  (held-out regression suite 0/16 to 6/16) and was promoted.
- Infrastructure: actor journals in SQLite, frozen-baseline reuse, validated batched
  evaluation, cached untrained evaluations and a host model-job lock cut the real Qwen
  campaign from 2,015 to 746 seconds with identical decisions
  ([performance record](verification/performance-local.md)).
- Phase 6: TRL GRPO (pinned 0.24.0) trains on answer-free tasks, and its only reward is
  the `RLWorldActor` transition for each completion, through a loopback world gateway.
  Per-update lineage, recomputed advantages and journal cross-checks with step replay
  are verified. Concurrency, lost replies and a Terse SIGKILL mid-rollout leave exactly
  one transition per rollout; a forged reward is caught by the journals. GRPO can continue
  an approved SFT adapter, measured against it. Two real Qwen2.5-0.5B campaigns found no
  improvement: from the instruct model 3 of 128 rollouts were rewarded; from the 6/16 SFT
  checkpoint the development-selected 7/16 candidate fell from 6/16 to 4/16 on the
  held-out suite and was vetoed, as was the next
  ([Phase 6 verification](verification/phase6-local.md)).
- Phase 7: a loopback research command center renders a campaign from stored files only
  (actor snapshots exported every 2 seconds, reports, run bundles, evidence), with every
  score linked to its file and hash. A recorder captures its one-screen live view while a
  campaign runs and exports 100x and 120x videos with FFmpeg; a recorder that cannot start
  is shown and blocks the campaign. Gates verified on a recorded fixture campaign: zero
  axe-core violations (desktop, mobile, light, dark), displayed scores equal to files,
  frame-exact playable exports. The real Qwen campaign has not been recorded
  ([Phase 7 verification](verification/phase7-local.md)).
- Phase 8: pinned EleutherAI harness, paired development diagnostics, bounded subprocesses,
  governance-checked release freeze, rehearsal, portable adapter/evidence bundles and a
  separate one-attempt final evaluator implemented. Fixture generation/reload and failure
  paths verified. The saved-output audit exposes a strict/flexible scoring disagreement;
  no sealed final evaluation or model improvement is claimed. The campaign now drives
  it: an actor freeze after the stop, release binding, rehearsal, a separately run final
  evaluator that records once, an evidence bundle with claims and gate checks, and a
  clean-copy reproduction, all verified on a fixture. The event-rules gate is not met
  ([eligibility review](event-eligibility.md)).
  See [Phase 8 verification](verification/phase8-local.md).
- Azure CPU reproduction: on a clean 8-core Arm VM the Qwen SFT campaign reproduced the
  0/16 to 6/16 selection and held-out result. A predeclared prompt/length ablation of that
  checkpoint under the official harness found **no gain** (strict 0 to 0 zero-shot; flexible
  9 to 6), so freeze refused the release and no final evaluation ran
  ([record](verification/azure-cpu-campaign.md)).
- Phase 1 is on GitHub main at `0e254b0`; its training-core CI passed. Phases 2 and 3
  CI passed on `3f03a63`, Phase 4 on `80eb305`; Phases 5 to 8 run in the same workflows.

## Collaboration boundaries

The checkout initially had no commits or source files. There was no commit from
which to create an isolated worktree. The first builder established the root
documentation and scoped training-core CI. The training-core workstream owns
`services/training-core/`, this file, and `docs/training-core-contract.md`.
Keep its dependency manifest and test suite local to that directory. Do not reset,
clean, stage, commit, or rewrite files belonging to other agents. Other workstreams
can proceed independently against the contract below. No other agent ownership has
been confirmed; suggested workstream assignments below are not active assignments.

## Phase 0 — Verify prerequisites and freeze interfaces

Work: check official upstream source and versions, pin model and data revisions,
agree typed messages/artifacts, choose a GPU provider and spending cap, separate
development and sealed test access, and establish the recording plan.

Gate: reproducible environment; verified model/data licenses; actual Terse and Relay
SDK examples; provider access; accepted evaluation and submission rules. Do not
guess SDK interfaces. Local documentation checks alone do not satisfy live service
verification.

Initial findings:

- The Qwen2.5-0.5B-Instruct model card declares Apache-2.0. The observed Hub revision
  is `7ae557604adf67be50417f59c2c2f167def9a775`.
- The GSM8K card declares MIT. The observed dataset revision is
  `740312add88f781978c0658806c59bc2815b9866`. Split the official **train** partition
  for research training/development. Keep the official **test** partition sealed.
- This worker deliberately pins Transformers 4.57.1 and PEFT 0.17.1 rather than
  assuming compatibility with newer major releases. Inspect installed signatures
  and execute a real optimization/reload smoke test.
- Agent Relay's unversioned introduction and versioned 7.1.1 messaging pages describe
  different interfaces. Phase 3 selected npm `@agent-relay/sdk@14.0.0` and tested it
  against `@relaycast/engine@12.0.0` locally, then against the hosted engine at
  `cast.agentrelay.com` ([hosted Relay verification](verification/relay-hosted.md)).
- Terse has active lifecycle changes upstream. Persistence and serialized execution
  must be tested using the selected installed version.
- The event page was not readable through the documentation fetch. Event rules,
  prebuilt-code eligibility, and submission requirements remain unverified.
- No GPU provider, paid compute allocation, Agent Relay Cloud account, Terse deployment,
  or recording setup has been verified by this workstream.

## Phase 1 — Measurable training core (first implementation)

Work: strict experiment configuration; content-hashed train/development manifests;
leakage checks; deterministic baseline predictions; bounded completion-only LoRA
optimization; adapter checksums; checkpoint reload in a fresh process; paired
development comparison; machine-readable evidence and real progress events.

Gate: run an actual optimizer, prove trainable weights changed, save and independently
reload the intended adapter, reproduce evaluation, and preserve sample predictions.
A tiny offline smoke model verifies mechanics only. A real Qwen/GSM8K development
run is a separate required milestone. A custom development scorer is not an official
GSM8K leaderboard result.

Initial implementation and actual local runs are recorded in
[`verification/phase1-local.md`](verification/phase1-local.md). Real Qwen optimization
and reload succeeded; a positive capability improvement is still unproven.

Suggested owner: training/evaluation workstream. Integration interface:
[`training-core-contract.md`](training-core-contract.md).

## Phase 2 — Authoritative durable coordination

Work: implement actual Terse campaign, experiment, governance, artifact registry,
and mathematical-world actors; immutable objective; serialized integer-unit budget
reservations; worker leases; idempotent transitions; artifact references.

Gate: concurrent reservations cannot overspend; repeated actions do not repeat
rewards; stale versions fail explicitly; state survives a real actor restart;
expired leases cannot complete jobs. Exercise A-before-B, B-before-A, concurrent,
and missing-event orderings. Do not store weights in actors.

Suggested owner: durable-state workstream. Depends on Phase 0 contracts; can develop
alongside Phase 1.

Implemented under `packages/terse-actors/`. [Actor contract](actor-contract.md) and
[local verification](verification/phase2-local.md) describe tested behavior and
limits. Phase 3 added Relay dispatch, delivery reconciliation and the worker adapter.

## Phase 3 — Synchronized research agents through Agent Relay

Work: director, SFT/data researcher, training engineer, evaluator, and independent
reviewer exchange structured assignments, proposals, acknowledgements, findings,
and corrections. Use campaign/experiment/message IDs everywhere. Actor state remains
authoritative. Durable dispatch/outbox plus reconciliation handles lost delivery.

Gate: an actual Relay assignment causes authorized work, duplicate messages cause
one job, early completion remains discoverable, reconnect recovers pending work.

Suggested owner: orchestration/Relay workstream. Depends on Phase 2 state interface.

Implemented under `services/orchestrator/` with `ResearchWorkflowActor` in
`packages/terse-actors/`. The [actor contract](actor-contract.md) describes the
outbox, and [local verification](verification/phase3-local.md) records each gate
check, injected fault and limitation. Gates were met locally against a loopback
Relaycast engine; the same suite later passed against the hosted engine
([hosted Relay verification](verification/relay-hosted.md)). Role handlers are scripted; Phase 4
replaces the director's fixed choices with evidence-driven selection.

## Phase 4 — Evidence-driven autonomous experiment selection

Work: diagnose baseline failures; propose at least two allowed strategies; request
preflight review; select using measured development results; revise a later proposal
using earlier evidence; stop when budget, improvement, or retry rules require it.
Persist hypotheses, decisions, evidence, and rejected alternatives. Structured model
calls may propose experiments; deterministic controls authorize execution.

Gate: a measured result changes a later decision without a human selecting the next
experiment. A fixed sequence or cosmetic agent conversation does not satisfy this.

Suggested owner: research-director workstream. Depends on Phases 1–3.

Implemented as `ResearchLedgerActor` in `packages/terse-actors/` and the director,
recipes and campaign loop in `services/orchestrator/`. The director is rule-based; its
structured decisions could come from a model later, but execution stays authorized by
deterministic reviewer and campaign checks. See the [actor contract](actor-contract.md)
and [local verification](verification/phase4-local.md), including the real Qwen
campaign, its uncertainty and its limits.

## Phase 5 — Independent enforceable governance

Work: separate permissions for objective, policy, final evaluator, and reviewer;
verify dataset access, reward versions, artifact identity, regression thresholds,
and evidence; make checkpoint promotion a serialized authorized operation.

Gate: an invalid candidate is vetoed with preserved evidence, all promotion paths
honor the veto, and the director takes a permitted corrective action. Label any
controlled failure injection. Final evaluation remains outside agent access.

Suggested owner: governance workstream. Hard checks should begin with Phase 2;
this phase verifies the complete enforcement path.

Implemented in `services/orchestrator/src/governance.ts` and the director's promotion
stage. See [local verification](verification/phase5-local.md) for the labeled fault
injection, the real promoted Qwen candidate, and the remaining isolation limits.

## Phase 6 — Real reward-driven training

Work: adapt a pinned TRL GRPO trainer to actual Terse world transitions; local policy
generation, bounded remote transitions, deterministic rewards, rollout artifacts,
optimizer updates, and next-rollout checkpoint lineage.

Gate: actor-returned rewards feed a real weight update; the next rollout uses those
weights; trajectories replay; concurrency and interruptions are tested. Environment
animation or a disconnected reward function does not count as RL integration.

Suggested owner: RL workstream. Depends on a reliable Phase 1 path and Phase 2 worlds.

Implemented as `forge_training/grpo.py` (worker), `services/orchestrator/src/worlds.ts`
(world gateway and journal verification) and a `grpo` campaign method in the director,
recipes, preflight and governance. The [actor contract](actor-contract.md) and
[training-core contract](training-core-contract.md) describe the protocol. The
[local verification](verification/phase6-local.md) records each gate check, the labeled
fault injections, an autonomous fixture campaign, two real Qwen campaigns (no
improvement; both reviewed candidates vetoed) and the limits.

## Phase 7 — Research command center and faithful recording

Work: dashboard consumes stored real events and artifacts; research graph, budgets,
agent messages, training metrics, environment inspector, governance, before/after
examples, downloads, and visible recording state. Capture the actual run and export
100x and 120x videos with FFmpeg.

Gate: rendered desktop/mobile/accessibility checks; displayed scores equal stored
artifacts; valid playable source and accelerated recordings; capture failure is
visible before campaign start. UI scaffolding can proceed in parallel after event
contracts settle, with fixtures visibly labeled as fixtures.

Suggested owner: frontend/capture workstream. Depends on stable event contracts.

First implemented in `apps/web/` (dashboard, recorder and launcher; retired in favor of the
root command center, recoverable from git history at `6ab37db`) with live actor snapshots
from `services/orchestrator/scripts/research.ts`. The [local verification](verification/phase7-local.md)
records each gate check, the recorded fixture campaign and the limits: the recording is
of the dashboard rendered headless, in VP8 WebM, and the real Qwen campaign is unrecorded.

## Phase 8 — Freeze, independently evaluate, rehearse, package

Work: freeze the development-selected approved checkpoint; run the pinned established
benchmark harness once in a separately permissioned final evaluator with identical
baseline/candidate settings; regression checks; evidence bundle; downloadable
checkpoint; clean-machine reproduction; complete two-minute demo.

Gate: sealed final results did not influence selection, all claims map to artifacts,
recordings match the run, and current event rules are satisfied. Report failures
and uncertainty. No claim of improvement, sponsor integration, deployment, or final
readiness precedes its corresponding gate.

## Verified upstream references

Phase 8 commands and trust/resource boundaries are documented in the
[harness runbook](../services/training-core/HARNESS.md). Final readiness still requires
a separately owned evaluator, a complete final run, a clean-machine model run (test
suites already reproduced: [record](verification/clean-machine.md)),
matching demo recording, and event-rule acceptance. Existing research agents remain
scripted; no real agent collaboration was added.

- [Qwen model card](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct)
- [GSM8K dataset](https://huggingface.co/datasets/openai/gsm8k)
- [Transformers 4.57.1 model API](https://huggingface.co/docs/transformers/v4.57.1/en/main_classes/model)
- [PEFT](https://huggingface.co/docs/peft/en/quicktour)
- [Established GSM8K harness task](https://github.com/EleutherAI/lm-evaluation-harness/blob/main/lm_eval/tasks/gsm8k/gsm8k.yaml)
- [Terse source and issues](https://github.com/TerseAI/durable-actors)
- [Agent Relay versioned messaging](https://agentrelay.com/docs/7.1.1/sending-messages)
- [Agent Relay SDK source](https://github.com/AgentWorkforce/relay) and
  [Relaycast engine source](https://github.com/AgentWorkforce/relaycast)
- [Event](https://events.ycombinator.com/haunted-hacks-2026)
