# Forge: Autonomous Post-Training Lab

Forge is being built to coordinate research agents that diagnose a model's failures,
propose and run post-training experiments, evaluate results, and select a checkpoint
under independent governance and a bounded compute budget.

**Current implementation:** a tested LoRA training/development-evaluation worker,
six durable Terse actors for campaigns, experiments, governance, artifacts, math
worlds and a message outbox, and Agent Relay dispatch between research roles. A
Relay-delivered, preflight-approved assignment drives real optimization; duplicate,
forged, lost and post-crash deliveries and service restarts are verified locally.
Role decisions are still scripted: autonomous experiment selection, independent
evidence verification, GRPO, dashboard and sealed final evaluation remain later
phases. No general model-superiority claim is made.

- [Implementation phases and acceptance gates](docs/implementation-phases.md)
- [Architecture and trust boundaries](docs/architecture.md)
- [Training worker interface for other agents](docs/training-core-contract.md)
- [Training worker setup and commands](services/training-core/README.md)
- [Durable actor setup, tests and demo](packages/terse-actors/README.md)
- [Actor integration contract](docs/actor-contract.md)
- [Relay orchestrator setup, tests and demo](services/orchestrator/README.md)
- [Phase 3 verification](docs/verification/phase3-local.md)
- [Phase 2 verification](docs/verification/phase2-local.md)
- [Actual local verification and limitations](docs/verification/phase1-local.md)

Start with the measurable training path, then connect durable coordination and real
agent communication. Report a model improvement only when the before/after evidence
supports it. Campaigns must be allowed to finish without a valid improvement.
