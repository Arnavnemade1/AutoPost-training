# Forge: Autonomous Post-Training Lab

Forge is being built to coordinate research agents that diagnose a model's failures,
propose and run post-training experiments, evaluate results, and select a checkpoint
under independent governance and a bounded compute budget.

The command-center workstream (repo root Next app) adds a live dashboard, GRPO, governance,
independent final evaluation and recording. See [command-center setup and trust
boundaries](docs/command-center.md). It is the project's dashboard and recorder; an
earlier separate `apps/web` dashboard was retired (recoverable from git history at
`6ab37db`). The status below describes the original
training/orchestrator profile.

**Production failures into improvements:** Forge scans deployed traffic for failures
without an answer key (audited at precision 1.00, recall 0.98 on 64 real Qwen answers),
trains on half of the labeled failures and measures the held-out half. In a recorded run
held-out production failures went from 0/33 to 8/33 and the sealed subset from 0/24 to
6/24, both validated by paired interval, mostly by fixing answer completion and format.
See [production failures](docs/production-failures.md).

**Current implementation:** a tested worker for LoRA SFT and for GRPO whose only
rewards are Terse math-world transitions, eight durable Terse actors (campaigns,
experiments, governance, artifacts, math worlds, a message outbox, a research ledger
and final evaluation), Agent Relay dispatch between research roles, a deterministic director that
picks each next experiment from measured development results, and an independent
reviewer that verifies artifacts, data, rewards, protocol and regressions from bytes
and actor journals before any promotion. In a local Qwen2.5-0.5B SFT campaign the
selected candidate moved a 16-example development diagnostic from 0/16 to 6/16, scored
6/16 versus 0/16 on a held-out regression set, and was approved and promoted. These are
small custom-scorer results, mostly answer-format learning, not a benchmark claim.
A Qwen GRPO campaign continuing that checkpoint found no improvement: its best
development candidate (7/16) regressed on held-out problems (6/16 to 4/16) and was
vetoed. Sealed final evaluation
is now implemented as a separate, one-attempt evaluator with a pinned EleutherAI
harness, paired development diagnostics, resource guards, checkpoint freeze and
release bundles. A campaign drives it after it stops: the promoted checkpoint is frozen
in an actor, its release is bound and rehearsed, and an evidence bundle maps every stated
number to a hashed artifact and reproduces from a clean copy (verified on a fixture).
No sealed final evaluation or benchmark improvement is claimed for this profile, and it is
not an eligible event submission ([event eligibility](docs/event-eligibility.md)). A
clean-machine Azure reproduction of the Qwen campaign, ablated under the official harness,
showed the 6/16 gain is answer-format specific (zero-shot strict 0/16 for both policies),
so the release gate refused it ([record](docs/verification/azure-cpu-campaign.md)).

- [Contribution rules](CONTRIBUTING.md)
- [Implementation phases and acceptance gates](docs/implementation-phases.md)
- [Demo notes and claim rules](docs/demo.md)
- [Architecture and trust boundaries](docs/architecture.md)
- [Training worker interface for other agents](docs/training-core-contract.md)
- [Training worker setup and commands](services/training-core/README.md)
- [Durable actor setup, tests and demo](packages/terse-actors/README.md)
- [Actor integration contract](docs/actor-contract.md)
- [Relay orchestrator setup, tests and demo](services/orchestrator/README.md)
- [Research command center and recorder](docs/command-center.md)
- [Production failures into improvements](docs/production-failures.md)
- [Training on a Modal H100](docs/remote-gpu.md)
- [Phase 8 harness, resource limits and release workflow](services/training-core/HARNESS.md)
- [Phase 8 verification](docs/verification/phase8-local.md)
- [Phase 7 verification](docs/verification/phase7-local.md)
- [Phase 6 verification](docs/verification/phase6-local.md)
- [Phase 5 verification](docs/verification/phase5-local.md)
- [Infrastructure performance](docs/verification/performance-local.md)
- [Phase 4 verification](docs/verification/phase4-local.md)
- [Phase 3 verification](docs/verification/phase3-local.md)
- [Phase 2 verification](docs/verification/phase2-local.md)
- [Actual local verification and limitations](docs/verification/phase1-local.md)

Start with the measurable training path, then connect durable coordination and real
agent communication. Report a model improvement only when the before/after evidence
supports it. Campaigns must be allowed to finish without a valid improvement.
