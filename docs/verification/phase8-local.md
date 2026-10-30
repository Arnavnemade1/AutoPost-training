# Phase 8 local verification

Implemented on the existing 16 GB Apple M4 checkout. This phase
adds a pinned benchmark harness and a release workflow. **No sealed final score,
new model improvement, independent production evaluator, or final readiness is claimed.**
No real agent collaboration was added.

## Implementation

- `forge-harness development`: EleutherAI `lm_eval==0.4.9.2`, its GSM8K prompt,
  extraction filters and exact-match scoring over verified development rows. The
  baseline and independently reloaded adapter run in separate processes under an
  identical hashed protocol. Silent prompt truncation is an error.
- `forge-harness audit`: applies the established task filters to previously stored
  predictions without loading weights or accessing a new dataset.
- Paired reports: strict and flexible scores, wins/losses, Wilson and bootstrap
  intervals, exact one-sided McNemar test, format-sensitive gains and cap diagnostics.
  Development-only experiment recommendations identify length ablations, retention
  controls and insufficient sample sizes. Flexible-score declines block real releases.
- Resource supervisor: existing host model lock, batch one, offline generation,
  MPS allocator cap, and sampled memory/available-memory/swap/disk/output/time guards.
  Failure preserves partial artifacts and stops only the job's process group.
- Freeze: verify stopped campaign promotion, original training bytes, governance
  approval, reviewed development report, held-out regression reports, and matching
  development harness evidence. Package the adapters and evidence with a manifest.
- Separate final CLI: private evaluator authority, HMAC-bound release grants, and
  atomic SQLite one-attempt consumption **before** reading final data. Replays,
  concurrent attempts, changed releases and reauthorization are refused. Crashes and
  failures do not refund a grant. Final evaluation requires the full pinned 1,319-row
  test file and rejects overlap with exposed research questions.
- Rehearsal: the release path on development data only. Fixtures cannot access final data.
- Backward compatibility: Phase 5 manifests missing the later `record_kind` default
  normalize in memory during verification. Original evidence files are never rewritten.

## Executed verification

The complete training-core suite passed **84 tests** before the last two additional
regression tests. The final focused harness suite passed **27 tests**, including those additions:
legacy-manifest preservation and durable grant consumption before final data access.
Checks run with offline Hub/Transformers settings. Ruff lint, format checks and
`pip check` passed. CI now installs the harness extra so these tests are not skipped.

The tests execute actual tiny-model optimization, fresh-process harness generation,
adapter reload, freeze and rehearsal. They also inject protocol/sample mismatches,
checkpoint tampering, vetoes, forged grants, concurrent consumes, evaluator failure,
prompt overflow and a subprocess timeout. Fixture approvals and synthetic data are
explicitly test evidence, not real governance or capability results.

## Real saved-output audit

Source: the Phase 5/optimized campaign's selected `r2-extend-full` run, adapter
`eddf05fc05712a4acd29f480bf92d85cab7b5e08afbbf4788a41c6b4ce17061c`.
The original run passes integrity verification. Output is preserved under ignored
`services/training-core/artifacts/phase8-sft-audit-final/`.

| Re-scoring the same 16 stored development completions | Baseline | SFT candidate |
| --- | ---: | ---: |
| Previous custom scorer (historical) | 0/16 | 6/16 |
| Harness strict extraction | 1/16 | 6/16 |
| Harness flexible extraction | 10/16 | 8/16 |
| Historical completion-cap hits | 9/16 | 1/16 |

Strict extraction finds five gains and no losses; flexible extraction finds three
gains and five losses. Two strict gains were already flexible-correct in the baseline.
The flexible delta is -12.5 percentage points, paired bootstrap interval
[-43.75, 18.75]. This small, selected development sample does not establish a regression
or improvement in general. Flexible extraction can match incidental numbers.

It does establish that the original strict-format score alone was insufficient for
selection. This audit does not regenerate responses or claim an official harness run.
The newly implemented release gate rejects this strict-gain/flexible-decline pattern.
The next research step is a paired length/prompt ablation, then a larger disjoint
training-split development set before selecting further training recipes.

## Bounded fresh Qwen attempt

The original Hub cache was absent. A first offline attempt refused to load the model.
Only the exact pinned Qwen model files were then provisioned into a new task-local
cache: **999,586,347 bytes**, monitored peak RSS about 110 MB during download.
No dataset was downloaded. The separate harness environment occupies approximately
321 MiB and reuses the existing training libraries; the original environment was not
upgraded or removed.

The second attempt stopped before weight loading because the initial harness parameter
cap was below the Qwen meta skeleton's count (tied embeddings are counted twice there).
The harness cap now matches the already verified Qwen campaign setting of 700 million.
The larger-model comparison was not rerun during wrap-up. Both failed attempts and
logs remain preserved. Neither emits a comparison or a benchmark score.

## Campaign integration

The harness, release and one-attempt evaluator above are the only scorer. A second pass
connects them to the research campaign, its actors and its evidence:

- `FinalEvaluationActor` (Terse) with a `final_evaluator` role. The owner freezes the
  promoted, governance-approved checkpoint only after the campaign stopped, then binds
  the hash of the one release packaged from it. Only the final evaluator records one
  sealed result, for that release.
- `research.ts --finalize` (`services/orchestrator/src/finalize.ts`): after the report is
  written, freeze, `forge-harness development`, `forge-harness freeze`, release binding
  and `forge-final rehearse`, with refusal probes recorded in `final/outcome.json`.
- `scripts/final-evaluate.ts`: the evaluator's side. It checks the release on disk is the
  bound one, then authorizes, runs `forge-final evaluate` and records the result.
- Evidence bundle (`src/bundle.ts`): claims with artifact, JSON pointer and SHA-256; gate
  checks; harness bundles re-verified with `forge-harness verify`; `checkpoint.tar.gz`;
  `SHA256SUMS`; copy verification and clean-copy reproduction.
- The event-rules check cites [the recorded eligibility review](../event-eligibility.md)
  and copies it into the bundle with its hash.

A final-evaluation dashboard section and a recording link to the campaign state were
built for `apps/web` and verified (axe-core clean, scores equal to files). That
dashboard was then retired in favor of the root command center, which reads only its
own profile's service ([command-center.md](../command-center.md)), so both were dropped
in the merge. For orchestrator campaigns, the bundle's `README.md`, `claims.json` and
`checks.json` are the human-readable view, and the recording check reports
`not-recorded`.

Executed on the offline constant fixture (`fixture-final`, mechanics only):

| Step | Observed |
| --- | --- |
| Campaign | baseline 0/2 development, three experiments at 2/2, `r1-explore-concise` approved and promoted, stopped |
| Development harness (GSM8K task, strict / flexible) | 0/2 → 2/2 / 0/2 → 2/2 |
| Release freeze and rehearsal | frozen; rehearsal 0/2 → 2/2 strict; `official_test_loaded: false` throughout |
| Refusals | director freeze `FORBIDDEN`, second freeze `FREEZE_FINAL`, release swap `RELEASE_FINAL`, research final record `FORBIDDEN`, rehearsal overwrite `FileExistsError`, fixture authorization refused |
| Final evaluator command | fixture release refused; nothing recorded |
| Bundle | 13 claims verified; selection-independence, harness-evidence and run-once checks passed; sealed final `not-run`; recording `not-recorded`; event rules `failed` (see below) |
| Clean-copy reproduction | bundle copied to a new directory and verified; rehearsal rerun from the copy gave identical generations, scores and comparison (12 s, 0.54 GB peak); a one-byte change in the copied adapter was reported |
| Cost | whole finalized campaign about 60 s, 1.4–1.6 GB peak resident memory |

Tests: `packages/terse-actors` (the final-evaluation actor test plus the existing suite)
and `services/orchestrator/tests/phase8.test.ts` (6 tests), inside the full orchestrator
suite. CI installs the harness extra for the orchestrator workflow.

## Remaining gates

The private registry enforces the one-attempt workflow, but same-user local execution
is not an adversarial security boundary. Deploy the evaluator under a separate OS
owner/container before calling it independent. Source/runtime hashes and task identity
are pinned. Clean-copy reproduction of the rehearsal is executed on the fixture, and
clean-machine reproduction of the test suites passed ([record](clean-machine.md)); a
clean-machine model run has not been executed. The complete sealed run (a real model, the
full 1,319-example test split, once) and a recording of it remain pending. The event gate
is not met: the published rules require code created during the event, so this build is
not an eligible submission without an organizer exception
([eligibility review](../event-eligibility.md)). See the [demo notes](../demo.md).

See the [harness runbook](../../services/training-core/HARNESS.md) and the upstream
[pinned GSM8K task](https://github.com/EleutherAI/lm-evaluation-harness/blob/v0.4.9.2/lm_eval/tasks/gsm8k/gsm8k.yaml).
