# Two-minute demo

The demo shows one campaign from start to sealed result. Every number it shows comes from
the campaign's evidence bundle (`final/bundle/claims.json`), never typed by hand. The
footage is the dashboard's own recording of that campaign; nothing is re-enacted.

## What exists today

| Piece | Status |
| --- | --- |
| Recorded campaign: research graph, experiments, governance, live at 100× | Verified on fixtures (Phase 7) |
| Freeze, release, rehearsal, evidence bundle, clean-copy reproduction | Verified on the `fixture-final` fixture (Phase 8) |
| Sealed GSM8K test score of a real model | **Not run yet.** Needs a real campaign, then one evaluator run |
| Agent swarm proposing experiments | The teammate's layer; today the director is deterministic |

A fixture campaign is fine for showing the mechanics, but its scores mean nothing, and
the dashboard says so in a banner. The headline result has to come from a real run.

## Producing the footage and the numbers

1. **Record a real campaign with finalization** (Qwen profile, under the memory caps in
   the orchestrator README; ask before starting a long run):

   ```sh
   cd apps/web
   FORGE_PYTHON=... FORGE_HARNESS_PYTHON=... npm run record -- qwen -- --finalize
   ```

   This produces the recording (`recording/export-100x.webm`, `export-120x.webm`), the
   frozen release, its rehearsal and a first bundle. The sealed test is not touched.
2. **Run the sealed test once, as the evaluator.** Provision the pinned GSM8K test file
   in the evaluator's own cache (HARNESS.md), then:

   ```sh
   forge-final init-authority --authority /private/evaluator/authority
   FORGE_HARNESS_PYTHON=... bun services/orchestrator/scripts/final-evaluate.ts \
     <campaign-dir> --authority /private/evaluator/authority
   ```

   It records the result in `FinalEvaluationActor` and rebuilds `final/bundle/` with the
   sealed claims. There is no second attempt: the grant is consumed before the data is
   read.
3. **Check the bundle** before showing any number from it:

   ```sh
   bun services/orchestrator/scripts/bundle.ts --verify <campaign-dir>/final/bundle
   FORGE_HARNESS_PYTHON=... bun services/orchestrator/scripts/bundle.ts \
     --reproduce <campaign-dir>/final/bundle --output /tmp/forge-reproduction
   ```

   `checks.json` must show `passed` for selection independence, harness evidence,
   run-once, claims and recording. Event rules stay `unverified` until someone reads the
   current rules and confirms them by hand.

## Script (120 seconds)

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:15 | Dashboard header, budget tile, objective | Post-training is a loop of experiments people run by hand. Forge runs it with research agents, a hard budget and independent governance. |
| 0:15–0:50 | `export-100x.webm` of the live view | The director diagnoses the baseline, launches recipes, measures them on development data, revises, and stops by rule. No human picks an experiment (`humanSelectedExperiments: false`). Every message and decision is durable. |
| 0:50–1:10 | Governance section; the veto run if shown | Before anything is promoted, a reviewer re-derives the checkpoint hash, data, protocol and held-out regressions from bytes. A tampered checkpoint is vetoed, and nothing can override a veto. |
| 1:10–1:40 | Final evaluation section | Only after the campaign stops is the promoted checkpoint frozen and packaged. The official GSM8K harness compares it with the starting policy under one frozen protocol, then the sealed test runs once, in a separate evaluator. Read the sealed strict and flexible numbers from the table, with the interval. |
| 1:40–2:00 | Downloads: `checks.json`, `checkpoint.tar.gz`, `SHA256SUMS` | Every number on screen maps to a hashed file. The checkpoint downloads. Anyone can copy the bundle, verify it and reproduce the evaluation. |

## Rules for what is said

- Quote the sealed strict-match result and its paired bootstrap interval from
  `claims.json` (`final-strict`). Say "improvement" only if `final-supported` is `true`:
  the predeclared gate needs a positive lower bound, p < .05 and no flexible-score drop.
- A result of "no improvement found" is a valid demo. It shows the system refusing to
  overclaim.
- Development and rehearsal numbers are selection data, not results.
- Do not show fixture numbers as model results. Keep the fixture banner visible if
  fixture footage is used.
- The local evaluator shares a user account with research. Say "separately keyed", not
  "independently hosted", until it runs under its own account.
