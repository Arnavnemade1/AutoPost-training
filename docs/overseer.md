# Production overseer

The overseer watches a deployed model's traffic at low cost, keeps statistics on how it fails,
and sends confirmed failures back to the lab, where the existing [production
failures](production-failures.md) loop trains on half and measures the other half. Open it in
the command center under **Production overseer**.

```
deployment ──▶ Supabase edge function `ingest` ──▶ private table ──pull──▶ lab
                                                                          │
   free checks on every trace ◀───────────────────────────────────────────┘
   small judge on suspicious traces + a random sample (daily budget)
   statistics, drift alerts, review queue
   reviewer labels ──▶ production scan ──▶ "Train on these failures"
```

## Getting traces in

**Remote deployments** post to the Supabase edge function `supabase/functions/ingest`:

- Batches of up to 500 traces and 4 MB.
- `Authorization: Bearer <ingest token>`.
- The function checks the token by its SHA-256, validates each trace, enforces the token's daily
  cap, and stores rows idempotently per source and trace id in the private table
  `forge_traces`.
- RLS is on, with no public policies. The function holds no model or judge credentials.

The lab pulls unpulled rows with the service key it already uses for the evidence archive, so no
lab port is ever exposed.

Setup steps:

1. Apply `supabase/migrations/900000000001_forge_overseer.sql`.
2. Deploy the function. `supabase/config.toml` turns off Supabase JWT checks for it, because it
   authenticates with its own tokens.
3. Issue a token per deployment:
   ```sh
   .venv/bin/python -m services.core.overseer token create --source web --pack gsm8k
   ```
   The token is printed once; only its hash is stored. Revoke with `token revoke <id>`.

**Apps on this machine** and demos can post to the local route `POST /overseer/traces`.

The [JSONL upload](production-failures.md) on the Production failures page still works for
batches of logged traffic.

**Client snippets:**

- `examples/overseer/client.py` (standard library only) and `examples/overseer/client.ts`
  queue traces and post them in the background. They never raise into your app.
- The Python client can wrap an OpenAI-compatible call and record its latency, tokens and
  `finish_reason`.

Trace fields:

- Required: `id`, `prompt`, `output`.
- Optional: `finish_reason`, `feedback {rating, correction}`, `timestamp`, `model_version`,
  `deployment`, `latency_ms`, `tokens {prompt, completion}`, `context` (the retrieved text, for
  groundedness checks) and up to 16 scalar `metadata` keys.

A trace whose prompt matches a sealed test question is kept only as a flag: its text never enters
overseer storage, and it can never be labeled.

## Tier one: free checks on every trace

| Signal | Kind | What it means |
| --- | --- | --- |
| The pack's detectors | hard | GSM8K: arithmetic slip, missing final answer. Other packs: the answer fails the task's checker format |
| `truncated` | hard | Generation stopped at the length limit |
| `empty` | hard | No answer |
| `user_reported` | hard | Negative rating or a user correction |
| `refusal` | soft | The model declined |
| `repetition` | soft | The answer loops on one phrase |
| `language_mismatch` | soft | Answer in a different script than the question |
| `latency_outlier` | soft | Above `FORGE_OVERSEER_LATENCY_SLO_MS`, or 1.5× the recent p99 |

## Tier two: a budgeted judge

Which traces are judged:

- every trace with a soft signal
- a deterministic random sample: a hash of the trace and the day, 2% by default
  (`FORGE_OVERSEER_SAMPLE_RATE`)

The random sample is the only unbiased estimate of the failure rate. The overseer reports it
separately, with a 95% Wilson interval.

The judge:

- **Endpoint:** any OpenAI-compatible endpoint (`FORGE_OVERSEER_JUDGE_URL`,
  `FORGE_OVERSEER_JUDGE_MODEL`, and `FORGE_OVERSEER_JUDGE_KEY_ENV` naming the key's variable).
- **Local judge:** a model on this machine is free, but waits while a campaign runs.
- **Hosted judge:** sees production text only after `FORGE_OVERSEER_SEND_TRACES=1`.
- **Budget:** each call reserves its worst-case cost before it is sent and settles to the
  measured usage after. A call that would cross `FORGE_OVERSEER_DAILY_USD` or
  `FORGE_OVERSEER_DAILY_CALLS` is not sent (fail closed). Prices come from
  `FORGE_OVERSEER_PRICE_IN_PER_M` and `FORGE_OVERSEER_PRICE_OUT_PER_M`.
- **Reasoning models:** endpoints that refuse `max_tokens`, `temperature` or `top_p` (OpenAI
  o-series, gpt-5 and later, also on Azure's v1 endpoint) are retried once with
  `max_completion_tokens` and the model's default sampling. Every result records this. Example:
  `FORGE_OVERSEER_JUDGE_URL=$AZURE_OPENAI_ENDPOINT`, `FORGE_OVERSEER_JUDGE_KEY_ENV=AZURE_OPENAI_API_KEY`.
- **Cache:** identical inputs are answered from cache.
- **Output:** a structured verdict (ok, fail or unsure), groundedness, hallucination (only when
  context was given), refusal, format, failure kinds, confidence and a short rationale. It never
  proposes a corrected answer.

## Statistics and alerts

**Statistics** come per task pack and model version:

- traces and flagged share
- rate per signal
- p50, p95 and p99 latency
- negative-feedback rate
- judged sample failure rate with its interval
- judged hallucinations
- today's judge spend against the budget

**Drift alerts** compare today with the previous seven days. Each is raised once per kind per
day:

- a signal rate up by at least 2 percentage points and three standard errors, with at least 50
  traces on both sides
- p95 latency up 50% or more
- traffic from a model version not seen before

## Back to the lab

The review queue lists:

- flagged traces and judged failures first
- then the random sample, which keeps the audit honest

A reviewer types the correct answer. It must pass the task's checker. User corrections and judge
notes are shown beside the trace for context only. They never pre-fill or become an answer,
because anyone can send a correction and a judge can be wrong.

**Send to the lab** (`POST /overseer/export`):

1. Writes recent traces and the reviewer labels as an ordinary production scan
   (`source: overseer`, tagged with the task pack).
2. The Production failures page then shows the detector audit and offers **Train on these
   failures**.
3. Labeled failures the free checks did not flag count as missed in the audit; they do not
   become training rows.
4. A campaign refuses a scan from a different task.

The cycle runs every `FORGE_OVERSEER_SECONDS` (60 by default, 0 to turn it off) inside the lab
API. **Check now** on the page, or `python -m services.core.overseer cycle`, runs it at once.

## Measured end to end

1. **Ingest.** 64 real Qwen2.5-0.5B answers (the traces behind `scan-d2f134cd`) were posted to
   `POST /overseer/traces` as source `support-bot`.
2. **One cycle.** The free checks flagged 62. The Azure gpt-6-luna judge, sampling at 10%,
   judged 5 random-sample traces and failed 2 (40%, 95% interval 11.8% to 76.9%).
3. **Labels.** 64 reviewer labels were entered through `POST /overseer/labels`, and
   **Send 64 labeled to the lab** exported `scan-ee5bfbec`. Its detector audit: precision
   100% (62 of 62), recall 98.4%, 0 false alarms.
4. **Train on these failures.** Campaign `forge-1d447446` (Modal H100, 15:32) fixed 8 of the
   33 held-out production failures (0/33 to 8/33, validated). The sealed final went from 0/24
   to 8/24, validated, with exp-002 (broad_sft) selected.

Setup note: the Supabase migration above must be applied before the lab's pull succeeds.
Without it, every cycle stops with a 404 from `forge_traces`.
