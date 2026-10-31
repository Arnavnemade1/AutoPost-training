# Evidence view

The lab's **Evidence** view (`/lab`, sidebar) shows every campaign's sealed result, the checks
behind it, and what it took to run. It reads `GET /evidence`, which derives each value from the
stored campaign snapshot, its events, or a fresh re-hash of its artifact files
(`services/core/evidence.py`). Nothing is estimated. A fact a campaign did not record is shown as
**Not recorded**, never as passed.

## Results

One row per campaign that reached a sealed final:

- **Sealed test**: correct answers before and after, on the same sealed questions. "Kept the
  original model" means no checkpoint earned selection, so the final compares the original with
  itself.
- **Change and interval**: the score change in percentage points and the 95% paired bootstrap
  interval, drawn on one axis shared by every row. The dashed line is zero.
- **Claim**: `validated` only when the whole interval is above zero; `uncertain` when the score
  rose but the interval reaches zero; `no improvement` otherwise (`services/core/verdict.py`).
  Campaigns run before claims were recorded show "No claim recorded" and no interval.
- **Production held-out**: the same comparison on held-out production failures, when the campaign
  trained on a production scan.

## Trust checks

| Check | Passes when | Read from |
| --- | --- | --- |
| Sealed test queried once | The one-time final claim is recorded in the durable actor, which refuses a second claim | `actor.final_claimed`, `sealed_ids` |
| Selection frozen before the final | Selection is frozen and based on development data only | `actor.selection_frozen`, `final.selection_basis` |
| Checkpoint reloaded independently | A saved adapter was loaded into a fresh model before scoring | `stage` events |
| Artifacts match their SHA-256 | Every artifact file, resolved exactly as the download route does, re-hashes to its registered SHA-256. Missing files make it partial; any mismatch fails it | artifact files on disk |
| Governance reviewed every gate | Governance decisions were saved; rejections and their reason codes are listed, not hidden | `reviews` |
| No sealed data in training | No governance record shows sealed data access. Disclosed integrity probes are counted separately | `reviews[].evidence` |
| Task pack hash pinned | Every gate saw one task pack SHA-256 | `reviews[].evidence.task_pack_sha256` |

Each check also shows how many campaigns pass it, out of those where it applies.

## Observability

Hardware, wall and compute time, Relay messages (a delivery counts only with Agent Relay's
confirmed receipt; readback is the recipient confirming it read the message), Terse state version
and saved decisions, artifact count and size, and per-role model calls, subagents and tokens from
`agent_calls`. Campaigns from before per-role usage recording say so instead of showing zeros.
