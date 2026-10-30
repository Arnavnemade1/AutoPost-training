# Phase 5 local verification

Verified on an Apple M4 (16 GB, macOS arm64). This record concerns
independent, enforceable checkpoint governance. Scores use the custom
`forge_numeric_v1` scorer on partitions of the official GSM8K **train** file; they are
not GSM8K benchmark results, and no model-superiority claim is made.

## What was built

- A governance reviewer (`services/orchestrator/src/governance.ts`) that trusts no
  worker or evaluator message. For each candidate it:
  - recomputes the checkpoint directory hash and the evaluation report hash from the
    files and compares them with the experiment and registry records, and re-verifies
    the run manifest;
  - re-derives the recipe's training selection from the allowed partition and compares
    it with the bytes the run actually staged, and requires the frozen development set;
  - checks the evaluation report against the frozen protocol, dataset, counts and
    checkpoint;
  - checks regressions: zero development examples lost versus the baseline, and no drop
    below the untrained model on a held-out regression suite that no recipe can train on.
- An evidence bundle per review, written before the decision and cited by hash in the
  terminal `GovernanceActor` decision.
- A promotion stage in the director: review the development-selected candidates in
  rank order (at most two). An approved candidate is promoted, subject to the
  campaign's own improvement threshold. After a veto, the director records a
  corrective ledger decision and reviews the next-ranked candidate.
- Roles stay separated by signing key: the owner fixes the objective and policy, only
  the reviewer records decisions, and the director and coordinator can only request
  promotion. No component reads the official GSM8K test split.

## Executed checks

| Location | Command | Observed result |
| --- | --- | --- |
| `services/orchestrator/` | `npm run check`, `npm run format:check` | Passed |
| `services/orchestrator/` | `FORGE_PYTHON=… npm test` | 33 tests passed across 7 files |
| `services/orchestrator/` | `FORGE_PYTHON=… npm run research -- qwen` | Campaign below; 2,015 seconds |

The actor package was unchanged in this phase; its 21 tests passed at `80eb305`.

## Gate: controlled failure injection (fixture)

**This is labeled failure injection.** `tests/phase5.test.ts` runs the full campaign
on the offline tiny model and appends a byte to the first reviewed checkpoint
(`adapter_config.json`) after the checkpoint is registered.

| Gate requirement | Observed |
| --- | --- |
| Invalid candidate vetoed with preserved evidence | Rejected with `ARTIFACT_IDENTITY` (regression suite not run on a tampered checkpoint). The recomputed checkpoint hash differs from the matching experiment and registry records. The evidence bundle's SHA-256 equals the hash cited in the decision. |
| All promotion paths honor the veto | Promotion by the director and by the coordinator both fail with `GOVERNANCE_VETO` |
| Director takes a permitted corrective action | The ledger records `governance-veto-<label>`, rejecting the candidate with the evidence hash, then reviews the next-ranked candidate before the stop entry |
| Fallback is governed, not waved through | The next candidate passes all five checks; promotion still fails with `NO_VALID_IMPROVEMENT` because the tiny fixture cannot beat its baseline. Nothing is promoted. |

## Real campaign: Qwen2.5-0.5B-Instruct with governance

Same model, data revision, seed, partitions and protocol as Phase 4. The 32 held-out
rows of the seed-42 split were divided: the first 16 are the development set (identical
to Phase 4), and the next 16 are the regression suite. Neither is trained on. No fault
was injected and no human selected an experiment.

The director reproduced Phase 4's decisions exactly: concise 3/16, full 4/16, full at 64
steps 6/16, full at 128 steps 4/16, then `NO_FURTHER_IMPROVEMENT`. It selected the 64-step
full recipe.

| Governance check | Result for the selected candidate |
| --- | --- |
| Artifact identity | Checkpoint and report hashes recomputed from bytes; match experiment and registry |
| Data access | Trained bytes equal the recipe's selection from the allowed partition; frozen development set |
| Evaluation protocol | Matches the frozen protocol, dataset, counts and checkpoint |
| Development regressions | 0 examples lost (the baseline answered none) |
| Held-out regression suite | Untrained 0/16, candidate **6/16**; allowed drop 0 |
| Decision | **Approved**; promoted as the campaign's best checkpoint (6/16 development) |

The regression suite was scored for the first time after selection, so unlike the
development score it is not inflated by choosing among candidates. Four reservations
were settled at the reserved upper bound (400,000 micro-USD, unmeasured local cost).
Reconciliation finished clean.

## Interpretation and limits

- Both suites are 16 problems from the same GSM8K-train distribution. They measure
  held-out problems of the target task, not other capabilities or safety. A broader
  regression suite is needed before claiming no capability regression.
- As in Phase 4, the baseline mostly fails the required `#### N` format; much of the
  gain is format learning, under a custom scorer. Intervals are wide.
- The reviewer shares the host, code and process with the worker. It uses its own
  signing key and re-derives facts from bytes, but infrastructure isolation, separate
  credentials and the sealed final evaluator belong to Phase 8. Governance decisions
  are terminal; revocation after promotion is not implemented.
- The fault injection covers checkpoint tampering. Data, protocol and regression
  rejections are covered by recipe unit tests and reviewer checks, not separate
  end-to-end injections.
- Run artifacts, including evidence bundles and `ledger.json`, are under the ignored
  `services/orchestrator/artifacts/governance-qwen-1793226438/` on the machine that ran it.
