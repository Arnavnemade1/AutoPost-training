# Any-task packs, distillation, DPO and overseer: local verification

What was built: [task packs](../task-packs.md), [teacher distillation](../distillation.md),
[DPO preference alignment](../preference-alignment.md) and the [production overseer](../overseer.md),
plus a fix for the local director crashing on production-scan campaigns without an API key.
Everything below was verified on fixtures, fake servers and a tiny offline model. **No model
improvement from any of it is claimed.**

## Suites

| Suite | Result |
| --- | --- |
| Root Python (`pytest tests`) | 169 passed, 6 skipped (5 need `modal`, 1 needs a live Relay bridge) |
| Training core (`pytest`) | 176 passed |
| Orchestrator (`npm test`) | 54 passed |
| Root lint, typecheck, format, build, Relay check | passed (one existing `<img>` lint warning) |
| Edge function and TypeScript client | type-check against a Deno shim |

## What the tests establish

- **GSM8K is unchanged** (`tests/test_packs.py`): the pack's splits equal a frozen copy of the
  original loader for three seeds; `collect` produces the same fields, order and scores; the
  checker matches the legacy scorer on 72 output and reference pairs.
- **Uploads** (`tests/test_pack_registration.py`): invalid and duplicate rows are counted, pools
  have exact sizes, previews never show development or sealed rows, sealed rows are never
  reused, chunked uploads verify their hashes, and launch refuses methods a task cannot run.
- **Distillation** (`services/training-core/tests/test_distill.py`): an excluded prompt stops the
  run before any request; only checker-accepted solutions are kept; a budget stop resumes with no
  repeated request; the API key never reaches disk; tampering fails `verify`; a held model lock
  refuses a local teacher. End to end through the API on a fake teacher, campaign rows are
  re-verified and filtered against development questions.
- **Governance** (`tests/test_actors.py`): v1 policies replay unchanged, v2 policies reject a
  swapped task pack, and each synthetic-data reason code fires.
- **DPO** (`tests/test_preference.py`): real TRL DPO optimizer steps change a tiny model's
  adapter and record reward margins; preference accuracy compares per-pair log-probabilities.
- **Overseer** (`tests/test_overseer.py`): idempotent intake, sealed prompts stored as flags
  only, each free check, a judge that stops at the daily cap and answers repeats from cache,
  deterministic sampling, drift alerts, reviewer-only labels and export to a production scan
  that a campaign on another task refuses.
- **Director** (`tests/test_director.py`): the no-key production-scan path now validates.

The UI was driven in the browser pane against a separate API: task selection, methods filtered
per task, the add-your-data wizard through its validation preview, the teacher-data dialog and
the overseer page, at desktop and phone widths with no console errors.

## Not verified

- No real model was trained or evaluated with these changes; Qwen weights are not cached here.
- No real teacher was called. A probe of the local Ollama model was skipped to save memory.
- The Supabase migration and edge function were not deployed or run, locally or hosted.
- DPO, teacher distillation and uploaded packs have not run in a real campaign.
- Registering a pack and labeling traces were exercised in tests only, not in the live lab data.
