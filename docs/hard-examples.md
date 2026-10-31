# Hard-example training

`hard_sft` is a campaign method for a model that already answers most of its benchmark. Training
such a model on every reference spends most steps on questions it already gets right and pulls
it toward the references' style. GSM8K references also carry calculator annotations such as
`<<4*20=80>>80`, which `broad_sft` and `targeted_sft` train verbatim.

## What it does

1. The base model answers every training question with the normal evaluation settings, in jobs of
   100 rows. Development, production held-out and sealed questions are not read.
2. A question it misses, or answers only by hitting the token limit, trains on its reference with
   the calculator annotations removed.
3. A question it gets right trains on its own checker-verified answer, which holds that behaviour
   in place.
4. Rows are ordered so that a third of the steps are hard questions, repeating as needed. Easy
   rows do not repeat within a pass. Labeled production failures come first.
5. Each of the campaign's `train_steps` is an optimizer step over 4 records, with linear warmup
   over the first tenth of training and cosine decay to zero.

The result of step 1 is saved once per campaign as `hard-examples.json`, and later experiments in
that campaign reuse it. Other methods keep their original single-record, constant-rate training.

The local director starts at learning rate 1e-4 and rank 16. If that run scores below the current
best on development it halves the rate; otherwise it doubles it.

## Campaign size

The verdict needs the paired 95% interval to clear zero. With no regressions, that takes at least
4 more correct answers on 24 questions, and at least 5 on 100. A 4B campaign should use 100
development and 100 final questions: on 24 questions a model at 19/24 must reach 23/24 to count.

```json
{
  "model_id": "Qwen/Qwen3.5-4B",
  "strategies": ["hard_sft"],
  "max_experiments": 2,
  "train_steps": 200,
  "dev_samples": 100,
  "final_samples": 100,
  "max_seconds": 14400
}
```

The 4B is remote-only, so run this with `FORGE_BACKEND=modal`. See [remote-gpu.md](remote-gpu.md).

## Limits

- This method has not yet produced a measured result on the 4B. Treat any expected gain as a
  hypothesis until a campaign reports it.
- Hard questions train on human references, not on solutions in the model's own voice.
- A change to `dev_samples` shifts which rows are in the training set, because the two are
  consecutive slices of one shuffle. Compare campaigns only at the same size and seed.
