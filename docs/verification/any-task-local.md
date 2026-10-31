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

## Connected traffic

Verified with the real agent process, the real lab API and command center, and a local source that
served OpenAI-shaped logs behind a bearer token, running as a local process:

- Connecting through the form was the only step. The agent worked out the field mapping and delivered
  61 traces; the free checks flagged them; **Disconnect** stopped the agent and kept those traces.
- After `kill -9` and an expired heartbeat, the supervisor restarted the agent, which resumed from
  its cursor with no loss and no duplicates.
- The credential was found only in the `0600` secrets file, not in the database, API replies, the
  configuration, the state file or the log.

### On a live SuperServe VM

A real VM ran the real provisioning code and agent, with fake credentials and public echo services
as the source and sink:

| Established | Result |
| --- | --- |
| Boot | About 2 seconds; default template has Python 3 and curl |
| The VM holds no real credential | Each variable is a stand-in token, different from the real value |
| Credential swap | The real value arrived for bearer, Basic (as the Langfuse preset sends it) and the ingest token |
| Scope | A stand-in sent to an allowed host its secret isn't bound to got a 403; neither it nor the real value reached that host |
| Allowlist | Allowed hosts reached; other domains and public IPs got 403; the metadata address timed out |
| Background agent | Kept polling, found the mapping by itself, and wrote its state where the lab reads it |
| Pause and resume | The same process carried on; pausing took under a second |
| Starting twice | No second agent |
| Clean-up | No sandboxes or secrets left |

This run found a defect no double could: binding a secret breaks `urllib`, so the first live agent could
reach nothing. Requests now go through curl there.

**Not established:** delivery through the real Supabase `ingest` function, because the sink in this run
was an echo service; the lab's full connect-supervise-disconnect flow against a live VM; and the Langfuse
preset against a live project, which was checked only against Langfuse's published API specification.

## Hephaestus

Verified on a complete second lab (its own Terse, Relay, API and web), through the real command center:

- The private conversation answered `status`, `tasks`, `help`, `chat` and a refused `start`.
- `tell` posted through real Agent Relay as a registered participant. All five other agents acknowledged it,
  its readback was verified, and it appeared in the research room under Hephaestus's name.
- `npm run test:relay` passes with Hephaestus as a participant, covering read receipts, duplicates,
  concurrent sends, restarts and forged copies.

The scenario tests in `tests/test_hephaestus.py` use a real database file with the Messages schema and a
scripted model, including a prompt injection that makes the model call a forbidden tool.

**Not established:** a real training campaign started by Hephaestus, a live iMessage thread (reading one
needs Full Disk Access), and any real model reply, including a directive changing what the director
chooses. That campaign was seeded, and no model was connected.

