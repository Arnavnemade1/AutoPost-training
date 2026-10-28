# Forge: Autonomous Post-Training Lab

Forge is being built to coordinate research agents that diagnose a model's failures,
propose and run post-training experiments, evaluate results, and select a checkpoint
under independent governance and a bounded compute budget.

**Current implementation:** a tested LoRA training/development-evaluation worker and
five durable Terse actors for campaigns, experiments, governance, artifacts and math
worlds. Native RPC, concurrent reservations and crash recovery are verified. Relay
dispatch and the adapter connecting actors to training are next; autonomous research,
independent evidence verification, GRPO, dashboard and sealed final evaluation remain
later phases. No general model-superiority claim is made.

- [Implementation phases and acceptance gates](docs/implementation-phases.md)
- [Architecture and trust boundaries](docs/architecture.md)
- [Training worker interface for other agents](docs/training-core-contract.md)
- [Training worker setup and commands](services/training-core/README.md)
- [Durable actor setup, tests and demo](packages/terse-actors/README.md)
- [Actor integration contract](docs/actor-contract.md)
- [Phase 2 verification](docs/verification/phase2-local.md)
- [Actual local verification and limitations](docs/verification/phase1-local.md)

Start with the measurable training path, then connect durable coordination and real
agent communication. Report a model improvement only when the before/after evidence
supports it. Campaigns must be allowed to finish without a valid improvement.
