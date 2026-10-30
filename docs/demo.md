# Demo notes and claim rules

The two-minute demo video comes from the root command center. It records a real
campaign continuously, then builds the demo with factual captions from that recording
(`scripts/service.py record-after --launch --export`; see
[command-center.md](command-center.md#record-and-export)). Nothing is re-enacted.

This page covers what may be claimed and how to show the orchestrator profile's Phase 8
evidence beside it. Every number on screen must come from a stored, hashed artifact.

## Eligibility first

The event's published rules require code written during the event. This
repository predates it, so it is not an eligible submission without an organizer
exception ([eligibility review](event-eligibility.md)). Present it as prior research
and preparation, and keep the true creation dates.

## The orchestrator profile's Phase 8 evidence

This profile has no recorder since `apps/web` was retired. Show its evidence bundle
instead:

```sh
cd services/orchestrator
FORGE_PYTHON=... FORGE_HARNESS_PYTHON=... npm run research -- qwen --finalize
FORGE_HARNESS_PYTHON=... bun scripts/bundle.ts artifacts/research-qwen-<timestamp>
bun scripts/bundle.ts --verify artifacts/research-qwen-<timestamp>/final/bundle
```

The bundle's `README.md` table (development harness, release rehearsal, sealed test),
`checks.json` and `checkpoint.tar.gz` are what to put on screen. The sealed row stays
"not run" until the evaluator runs it once:

```sh
FORGE_HARNESS_PYTHON=... bun scripts/final-evaluate.ts <campaign-dir> --authority <dir>
```

That run needs the evaluator's own authority and the pinned GSM8K test file in its cache
([HARNESS.md](../services/training-core/HARNESS.md)). The grant is consumed before the
data is read, so there is no second attempt. Ask before starting a long Qwen run on this
laptop, and use the memory caps in the orchestrator README.

## Rules for what is said

- Quote a sealed result only from a bundle's `claims.json` (`final-strict`) with its
  paired interval. Say "improvement" only if `final-supported` is `true`: positive lower
  bound, p < .05 and no flexible-score drop.
- "No improvement found" is a valid result. It shows the system refusing to overclaim.
- Development and rehearsal numbers are selection data, not results.
- Fixture numbers are mechanics only. Never present them as model results.
- The local evaluator shares a user account with research. Say "separately keyed", not
  "independently hosted", unless it runs under its own account or VM.
- The command center's GSM8K results are a disclosed subset under its own protocol
  (lm-eval 0.4.13). The orchestrator profile uses the full test split (lm-eval 0.4.9.2).
  Do not mix numbers across the two profiles.
