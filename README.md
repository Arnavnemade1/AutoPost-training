# Forge: Autonomous Post-Training Lab

Forge is being built to coordinate research agents that diagnose a model's failures,
propose and run post-training experiments, evaluate results, and select a checkpoint
under independent governance and a bounded compute budget.

The isolated command-center workstream adds a live dashboard, GRPO, governance,
independent final evaluation and recording. See [command-center setup and trust
boundaries](docs/command-center.md). The status below describes the original
training/orchestrator profile.

**Current implementation:** a tested LoRA training/development-evaluation worker,
seven durable Terse actors (campaigns, experiments, governance, artifacts, math worlds,
a message outbox and a research ledger), Agent Relay dispatch between research roles,
a deterministic director that picks each next experiment from measured development
results, and an independent reviewer that verifies artifacts, data, protocol and
regressions from bytes before any promotion. In a local Qwen2.5-0.5B campaign the
selected candidate moved a 16-example development diagnostic from 0/16 to 6/16, scored
6/16 versus 0/16 on a held-out regression set, and was approved and promoted. These are
small custom-scorer results, mostly answer-format learning, not a benchmark claim.
GRPO, dashboard and sealed final evaluation remain later phases.

- [Implementation phases and acceptance gates](docs/implementation-phases.md)
- [Architecture and trust boundaries](docs/architecture.md)
- [Training worker interface for other agents](docs/training-core-contract.md)
- [Training worker setup and commands](services/training-core/README.md)
- [Durable actor setup, tests and demo](packages/terse-actors/README.md)
- [Actor integration contract](docs/actor-contract.md)
- [Relay orchestrator setup, tests and demo](services/orchestrator/README.md)
- [Phase 5 verification](docs/verification/phase5-local.md)
- [Phase 4 verification](docs/verification/phase4-local.md)
- [Phase 3 verification](docs/verification/phase3-local.md)
- [Phase 2 verification](docs/verification/phase2-local.md)
- [Actual local verification and limitations](docs/verification/phase1-local.md)

Start with the measurable training path, then connect durable coordination and real
agent communication. Report a model improvement only when the before/after evidence
supports it. Campaigns must be allowed to finish without a valid improvement.
