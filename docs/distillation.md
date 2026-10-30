# Teacher distillation

A stronger teacher model writes solutions to a task's training questions, the task's checker
keeps only the correct ones, and the student trains on those verified solutions. Any
OpenAI-compatible chat endpoint can teach: Ollama (for example a local `qwen3.5:4b`), vLLM, LM
Studio, a llama.cpp server or a hosted API.

Distillation has two parts:

- `forge-distill`, a standalone command in `services/training-core`, usable without the lab.
- The `distill_sft` campaign method, which trains on a dataset that tool produced.

## The standalone tool

```sh
forge-distill probe distill.json    # list models, read the digest, send one tiny request
forge-distill run distill.json      # write a verified teacher dataset
forge-distill verify output-dir     # re-derive every hash from bytes
```

`python -m forge_training.distill_cli` runs the same command without the installed script.

The configuration file sets:

- `teacher`: its kind, endpoint root ending in `/v1`, model, optional API-key environment
  variable name, and `teacher_terms`, a required statement of why its outputs may train another
  model.
- `task`: a `TaskSpec`, meaning the instruction and checker.
- `prompts`: a training-core training dataset whose rows carry reference answers.
- `exclude`: datasets that must not reach the teacher.
- `exclude_keys`: files of hashed sealed question keys.
- `sampling`: attempts per question, temperature, token limit and seed.
- `selection`: `shortest_correct` or `first_correct`.
- `budget`: request, token, time and optional dollar limits.

`run` works in this order:

1. Checks every prompt against every excluded set **before the first request**, and refuses if
   any overlap. Development, evaluation and sealed questions are never sent to a teacher.
2. Records the teacher: kind, endpoint without credentials, model and, for Ollama, its digest.
3. Sends requests through an append-only, fsync'd cache keyed by teacher, prompt, sampling and
   attempt. A run stopped by its budget resumes without repeating a request.
4. Strips reasoning (`<think>` blocks), then keeps a sample only if it is non-empty, was not cut
   off at the token limit, and the task's checker accepts it against the reference.
5. Writes `train.jsonl` as an ordinary training-core dataset with `source_split: synthetic`,
   bound to `distillation.json` by hash.
6. Writes `distillation.json`, holding the teacher, terms, sampling, checker, separation
   evidence, rejection reasons, usage and hashes, and `samples.jsonl`, every raw sample kept or
   rejected.
7. Unloads an Ollama teacher from memory and waits until it is gone.

A teacher on this machine takes the shared model-job lock and refuses to start while a campaign
or another model job holds it. The campaign worker takes the same lock, so a local teacher and
training never share the 16 GB of memory.

API keys are read from the named environment variable and sent as a bearer token. They are never
written to any output file; `tests/test_distill.py` checks this.

## Terms of use

Some hosted model providers forbid using their outputs to train other models. Forge cannot decide
this for you. It requires the operator to state the basis in `teacher_terms`, records it
verbatim and refuses to train on a dataset without it.

## In a campaign

1. In **New campaign**, choose the task, tick **Teacher distillation** and use **Prepare teacher
   data**. The same is available as `POST /packs/{id}/teacher-data`, a background job polled
   with `GET /packs/{id}/teacher-data/{syn_id}`. `POST /distill/probe` tests a teacher first.
2. The job writes the pack's training questions as the prompt set and the development questions
   and sealed question keys as exclusions. The output lives in
   `data/packs/<pack>/synthetic/syn-<id>/`.
3. A campaign naming that dataset (`synthetic_dataset`) re-verifies it from bytes before
   training. It keeps only rows whose question is in the campaign's own training set, drops any
   that collide with development, held-out production or sealed questions, and reports the
   count as `TEACHER_DATA_VERIFIED`.
4. A `distill_sft` experiment trains labeled production failures first, then the teacher
   solutions. It never mixes in the original references, so the comparison against `broad_sft`
   on the same questions stays clean.

Governance checks the synthetic-data evidence on both preflight and checkpoint reviews and rejects
it for any of these:

- `SYNTHETIC_PROVENANCE_MISSING`: the record did not re-verify from bytes
- `TEACHER_TERMS_MISSING`
- `SYNTHETIC_CHECKER_MISMATCH`: a different checker than the pack's
- `SYNTHETIC_SEPARATION_FAILED`
- `SYNTHETIC_UNVERIFIED`: format-only selection, unless the policy allows it

## Limits

- A teacher may have seen a public benchmark during its own training. Gains on such a benchmark
  can partly reflect the teacher's contamination; reports say so.
- Checker-verified means the final answer matches the reference. A correct answer can still sit
  on flawed reasoning.
- Large local teachers are slow on a laptop: best-of-4 over hundreds of questions can take
  hours. Start with the 8-question check.
