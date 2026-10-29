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
