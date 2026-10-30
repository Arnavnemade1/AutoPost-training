# Production failures into improvements

Forge can read a deployed model's traffic, find answers that are probably wrong
without an answer key, and turn labeled failures into a targeted campaign whose
effect is measured on failures it never trained on.

## Flow

1. **Traces in.** JSONL, one interaction per line:
   `{"id", "prompt", "output", "finish_reason"?, "feedback"?: {"rating"?, "correction"?}, "timestamp"?}`.
   A malformed row is reported with its line number and skipped; it never blanks a scan.
   At most 5,000 traces per scan.
2. **Sealed-test exclusion.** Any trace whose normalized question matches a GSM8K test
   question is excluded before detection, so production data can never leak the sealed set.
3. **Detection without the answer key** (`services/core/production.py`):
   | Detector | Signal |
   |---|---|
   | `arithmetic_slip` | A calculation written in the output (`12 * 7 = 74`) is recomputed and differs beyond the stated precision. Percent notation is skipped to avoid false alarms. |
   | `missing_final_answer` | No final `#### <number>` line, using training core's own scorer. |
   | `truncated` | Generation stopped at the length limit. |
   | `user_reported` | Negative rating or a user correction. |
4. **Detector audit.** If reviewer labels are supplied (`{"id", "answer"}` JSONL), the scan
   reports precision and recall of "flagged" against them. Labels are never used to detect.
5. **Campaign.** `POST /campaigns {"production_scan": "scan-…"}`. Failures with a reference
   (a reviewer label; user corrections only flag a failure and are never used as answers, since anyone can send one) whose final answer is
   actually wrong are split by a stable hash of the normalized question: half join
   training, half are held out. Training rows sharing a question with either half, and
   production rows duplicating development questions, are dropped; separation is verified
   with training core's `verify_separation`. `targeted_sft` trains production failures
   first. The data role posts `PRODUCTION_FAILURES_TRIAGED` to the director over Relay,
   and the director's input carries the failure profile.
6. **Measurement.** The held-out production failures are evaluated at baseline and after
   every experiment. The final result reports before and after counts, which held-out
   failures were fixed, and the same claim rule as the sealed evaluation: *validated*
   only when the 95% paired bootstrap interval is above zero, *uncertain* for a smaller
   gain, *none* otherwise.

## Simulated traffic for the demo

`.venv/bin/python scripts/simulate-production.py --count 64` runs the real base
Qwen2.5-0.5B on a fixed slice of GSM8K's **train** split (`live-*` ids) and scans it.
Outputs are real model generations; the reference answers go to a separate labels file
standing in for a human reviewer. No user feedback is invented, so `user_reported` is
zero on simulated traffic. Present it as simulated traffic.

## API

- `POST /production/scans {name, traces, labels?}` creates a scan (422 on unreadable input).
- `GET /production/scans` lists summaries; `GET /production/scans/{id}` returns findings.

## Limits

- Detectors find a subset of wrong answers: an answer with correct arithmetic and a wrong
  plan is invisible to them. The audit's recall says how much is missed.
- Held-out production failures are the same *kind* of failure as the trained half, not
  the same prompts; with small counts the claim will usually be *uncertain*.

## Measured results (Apple M3, local scorer)

Scan `scan-d2f134cd`: 64 simulated-traffic answers from the base model, 62 flagged
(62 missing final answer, 38 truncated, 1 arithmetic slip), detector precision 1.00 and
recall 0.98 against labels. Every reported arithmetic slip was checked by hand; two false
alarms an earlier detector raised on this real output (LaTeX `\times`, chained equations)
are regression tests. 28 labeled failures trained, 33 held out (one dropped for
duplicating a development question).

| Campaign | Steps | Held-out production failures | Sealed GSM8K subset | Claim |
|---|---|---|---|---|
| `forge-f530d7fa` | 24 | 0/33 to 0/33 | 0/24 to 0/24 | none |
| `forge-ad0318ee` | 96 | 0/33 to 11/33, interval +18.2 to +51.5 pts | 0/24 to 8/24, +16.7 to +54.2 pts | validated |
| `forge-011e8b59` (recorded, launched from the page) | 96 | 0/33 to 8/33, interval +12.1 to +39.4 pts | 0/24 to 6/24, +8.3 to +41.7 pts | validated |

No held-out production failure or sealed question regressed in any run. In
`forge-011e8b59` the targeted experiment fixed more held-out production failures (11)
than the broad one (8), but selection uses development data only (9/24 beat 7/24), so
the broad checkpoint was chosen; held-out production failures measure, they never select.

What improved is mostly answer completion and format (a usable `#### <number>` final
line within the length limit), the dominant production failure here. These are small
samples from one model and one dataset; they show the loop works end to end, not general
reasoning gains. The 24-step run is kept as a negative result.

Recording: `artifacts/forge-011e8b59/recording/` (UTC-stamped frames, full-speed MP4,
100x and 120x exports, `video-manifest.json` with SHA-256 hashes), captured with
`scripts/capture.py --launch --production-scan scan-d2f134cd --no-tour`.

