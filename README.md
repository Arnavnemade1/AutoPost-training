# Forge: Autonomous Post-Training Lab

Forge is being built to coordinate research agents that diagnose a model's failures,
propose and run post-training experiments, evaluate results, and select a checkpoint
under independent governance and a bounded compute budget.

**Current implementation:** a standalone, tested LoRA training/development-evaluation
worker. The complete autonomous research organization is planned; live Terse/Relay
coordination, enforced governance, GRPO, dashboard, sealed final evaluation, and demo
recording remain subsequent phases. No general model-superiority claim is made.

- [Implementation phases and acceptance gates](docs/implementation-phases.md)
- [Architecture and trust boundaries](docs/architecture.md)
- [Training worker interface for other agents](docs/training-core-contract.md)
- [Training worker setup and commands](services/training-core/README.md)
- [Actual local verification and limitations](docs/verification/phase1-local.md)

Start with the measurable training path, then connect durable coordination and real
agent communication. Report a model improvement only when the before/after evidence
supports it. Campaigns must be allowed to finish without a valid improvement.
