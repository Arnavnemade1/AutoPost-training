# Infrastructure performance verification

Measured October 28, 2026 on an Apple M4 (16 GB, macOS arm64), for commit `611fd6a`.
These are local timings of the same workloads before and after the change; they are
not benchmark claims about any model.

## Where time went before

The Phase 5 Qwen2.5-0.5B campaign (`e1fe498`) took 2,015 seconds after setup:

| Work | Seconds | Share |
| --- | --- | --- |
| Worker re-evaluating the untrained baseline in every run | 681 | 34% |
| Worker candidate evaluations | 470 | 23% |
| Evaluator reproductions | 422 | 21% |
| Governance regression evaluations | 245 | 12% |
| Training | 133 | 7% |
| Orchestration, Relay, Terse and Python checks | about 64 | about 3% |

Generation ran one example at a time at about 27 tokens per second. Python `validate`
and `verify` take about 0.06 seconds each, and actor authorization costs about 41
microseconds of CPU per request; neither was worth optimizing.

## Changes

1. **Actor journals in SQLite.** Terse rewrites and re-reads `@Persisted` fields whole
   on every invocation, so command cost grew with each actor's journal and receipts.
   Both now live in actor SQLite rows in the command's transaction.
2. **Lease cadence.** Workers renew at a third of the campaign's `maxLeaseMs` instead
   of every 2 seconds; research campaigns allow 60-second leases.
3. **Frozen baseline reuse.** Runs reuse the campaign's untrained evaluation, by hash
   and only on an exact match of model, data, samples and protocol.
4. **Batched evaluation.** Left-padded greedy batches, recorded in the protocol and
   adopted only when the untrained model's predictions match batch size 1 exactly.
5. **Cached untrained evaluations** keyed by campaign, label, model, data and protocol.
6. **Host-wide model-job lock** so concurrent jobs queue instead of exhausting memory
   (two concurrent Qwen jobs had pushed swap to 11.8 of 13.3 GB).

## Actor command cost

Native Terse runtime, one actor receiving signed commands (`scratchpad` benchmark):

| Existing journal | Lease renewal before | Lease renewal after |
| --- | --- | --- |
| 2 | 19 ms | 16 ms |
| 1,002 | 42 ms | 19 ms |
| 2,752 | 114 ms | 19 ms |

| Workflow outbox | Publish before | Publish after | Full snapshot read before | After |
| --- | --- | --- | --- | --- |
| 250 | 26 ms | 20 ms | 12 ms | 7 ms |
| 1,500 | 118 ms | 55 ms | 76 ms | 41 ms |

The remaining outbox growth comes from the messages themselves, which are still domain
state in a persisted field. Before the change, the 10,000-entry journal cap combined
with 2-second heartbeats would have rejected lease renewal after about 5.5 hours,
cancelling a long training run; the cap is now 1,000,000 entries.

## Generation throughput

Qwen2.5-0.5B on MPS, float32, greedy, 8 development prompts, 96 new tokens:
batch 1 at 27 tokens/s, batch 4 at 59 tokens/s (2.2x), batch 8 at 104 tokens/s (3.8x),
with token-identical outputs at every batch size for these prompts.

## Real campaign after the change

Same profile, seed, partitions and decisions as Phase 5, with an empty evaluation cache:

| | Before (`e1fe498`) | After (`611fd6a`) |
| --- | --- | --- |
| Campaign after setup | 2,015 s | **746 s** |
| Per-experiment worker run | 295–386 s | 88–122 s |
| Evaluator reproduction | 78–129 s | 34–63 s |
| Regression baseline / candidate | 152 s / 93 s | 52 s / 41 s |
| Batch size used | 1 | 8 (16 of 16 predictions identical to batch 1) |
| Scores (concise, full, 64 steps, 128 steps) | 3, 4, 6, 4 of 16 | 3, 4, 6, 4 of 16 |
| Outcome | 64-step full recipe approved and promoted | identical |

Setup also changed. The first run paid 70 seconds for the batched frozen baseline and
215 seconds, once, for the batch-size-1 reference; both, and the 52-second regression
baseline, are now cached by key. A rerun of the same campaign skips those three
evaluations. That rerun was not measured.

## Limits

- Batch agreement is checked on the untrained model only; trained candidates are
  evaluated at the adopted batch size without a batch-size-1 comparison. Baseline and
  candidates always share one protocol, so comparisons remain like for like.
- The cache trusts the local filesystem. Entries are checked against their key, and the
  key covers the training core's source hash and runtime versions.
- The model-job lock coordinates processes using this training core version. A tool that
  loads models without it, such as an older checkout, is not coordinated.
- The full outbox snapshot is still read several times per orchestration cycle; with
  long campaigns that remains O(messages) per read.
