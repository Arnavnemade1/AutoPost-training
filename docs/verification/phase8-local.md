# Phase 8 local verification

Implemented October 29, 2026 on the existing 16 GB Apple M4 checkout. This phase
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

## Remaining gates

The private registry enforces the one-attempt workflow, but same-user local execution
is not an adversarial security boundary. Deploy the evaluator under a separate OS
owner/container before calling it independent. Source/runtime hashes and task identity
are pinned; clean-machine reproduction of the test suites passed ([record](clean-machine.md)); a clean-machine model run has not been executed. The complete sealed
run, matching two-minute demo recording, and current event-rule acceptance remain pending.

See the [harness runbook](../../services/training-core/HARNESS.md) and the upstream
[pinned GSM8K task](https://github.com/EleutherAI/lm-evaluation-harness/blob/v0.4.9.2/lm_eval/tasks/gsm8k/gsm8k.yaml).
