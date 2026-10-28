# Forge implementation phases

Source: user-supplied PRD v1.0, October 27, 2026. This is an implementation plan,
not a statement that the full product or model improvement has been demonstrated.

## Success measure

Forge should autonomously improve a **specified baseline model on a specified
capability**, subject to compute, provenance, regression, and governance constraints.
Beating arbitrary existing models is an aspiration, not an acceptance criterion we
can promise. Report the named baseline, frozen evaluation settings, sample counts,
uncertainty, and limitations. A valid campaign can conclude **no improvement found**.

## Current status after the first build

- Phase 0: model/data revisions and local training runtime verified; live sponsor
  infrastructure, GPU-provider billing, final-evaluation permissions, and event rules pending.
- Phase 1: working LoRA worker, independent reload/evaluation, preserved evidence,
  35 passing tests, lint/format checks, and dependency checks. A real four-step Qwen
  run succeeded mechanically but showed no development improvement (0/8 to 0/8).
- Phases 2–8: planned; no live integration or completed autonomous campaign claimed.
- GitHub CI: workflow prepared, not run. No push or deployment has been performed.

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
  different interfaces. Select and test one version before integration.
- Terse has active lifecycle changes upstream. Persistence and serialized execution
  must be tested using the selected installed version.
- The event page was not readable through the documentation fetch. Event rules,
  prebuilt-code eligibility, and submission requirements remain unverified.
- No GPU provider, paid compute allocation, live Relay workspace, Terse deployment,
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

## Phase 3 — Synchronized research agents through Agent Relay

Work: director, SFT/data researcher, training engineer, evaluator, and independent
reviewer exchange structured assignments, proposals, acknowledgements, findings,
and corrections. Use campaign/experiment/message IDs everywhere. Actor state remains
authoritative. Durable dispatch/outbox plus reconciliation handles lost delivery.

Gate: an actual Relay assignment causes authorized work, duplicate messages cause
one job, early completion remains discoverable, reconnect recovers pending work.

Suggested owner: orchestration/Relay workstream. Depends on Phase 2 state interface.

## Phase 4 — Evidence-driven autonomous experiment selection

Work: diagnose baseline failures; propose at least two allowed strategies; request
preflight review; select using measured development results; revise a later proposal
using earlier evidence; stop when budget, improvement, or retry rules require it.
Persist hypotheses, decisions, evidence, and rejected alternatives. Structured model
calls may propose experiments; deterministic controls authorize execution.

Gate: a measured result changes a later decision without a human selecting the next
experiment. A fixed sequence or cosmetic agent conversation does not satisfy this.

Suggested owner: research-director workstream. Depends on Phases 1–3.

## Phase 5 — Independent enforceable governance

Work: separate permissions for objective, policy, final evaluator, and reviewer;
verify dataset access, reward versions, artifact identity, regression thresholds,
and evidence; make checkpoint promotion a serialized authorized operation.

Gate: an invalid candidate is vetoed with preserved evidence, all promotion paths
honor the veto, and the director takes a permitted corrective action. Label any
controlled failure injection. Final evaluation remains outside agent access.

Suggested owner: governance workstream. Hard checks should begin with Phase 2;
this phase verifies the complete enforcement path.

## Phase 6 — Real reward-driven training

Work: adapt a pinned TRL GRPO trainer to actual Terse world transitions; local policy
generation, bounded remote transitions, deterministic rewards, rollout artifacts,
optimizer updates, and next-rollout checkpoint lineage.

Gate: actor-returned rewards feed a real weight update; the next rollout uses those
weights; trajectories replay; concurrency and interruptions are tested. Environment
animation or a disconnected reward function does not count as RL integration.

Suggested owner: RL workstream. Depends on a reliable Phase 1 path and Phase 2 worlds.

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

- [Qwen model card](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct)
- [GSM8K dataset](https://huggingface.co/datasets/openai/gsm8k)
- [Transformers 4.57.1 model API](https://huggingface.co/docs/transformers/v4.57.1/en/main_classes/model)
- [PEFT](https://huggingface.co/docs/peft/en/quicktour)
- [Established GSM8K harness task](https://github.com/EleutherAI/lm-evaluation-harness/blob/main/lm_eval/tasks/gsm8k/gsm8k.yaml)
- [Terse source and issues](https://github.com/TerseAI/durable-actors)
- [Agent Relay versioned messaging](https://agentrelay.com/docs/7.1.1/sending-messages)
- [Event](https://events.ycombinator.com/haunted-hacks-2026)
