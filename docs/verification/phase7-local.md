# Phase 7 local verification

> Historical record. `apps/web` was retired in favor of the root command center
> ([command-center.md](../command-center.md)); its code is recoverable from git history
> at `6ab37db`.

Verified on an Apple M4 (16 GB, macOS arm64). This record concerns the
research command center and its faithful recording. The recorded campaign used the
offline tiny fixture model; its scores carry no benchmark meaning. The real Qwen GRPO
campaign was viewed in the dashboard from its stored files but has not been recorded.

## What was built

- **Live actor snapshots** (`services/orchestrator/scripts/research.ts`). Every 2 seconds
  during a campaign, and once at its end, the campaign writes `live/state.json` atomically:
  campaign, ledger, workflow-outbox and experiment snapshots, read with public actor
  reads. The dashboard never connects to actors and holds no credentials.
- **Dashboard** (`apps/web/`). A loopback server renders one campaign directory from
  stored files only, with each score linked to its file and SHA-256. It has two views:
  - **Full view:** headline tiles, the research-ledger graph, experiments, a training
    chart, an environment inspector of world transitions, governance evidence,
    before/after examples, Relay agent messages, recording state with playable
    exports, and downloads with hashes.
  - **Live view:** the parts that change during a run, sized to one 1440×900 screen and
    refreshed every 2 seconds.

  `/files/` serves only the evidence files the dashboard lists. Fixture campaigns show a
  banner. Charts follow the validated reference palette (validator: all checks pass in
  both modes; the two light slots below 3:1 carry end labels and a table view).
- **Recorder** (`apps/web/src/recorder.ts`) and **launcher**
  (`apps/web/scripts/record-campaign.ts`).
  - **Order:** serve the directory, start the recorder, then start the campaign. If the
    recorder cannot start, its state file says why, the dashboard shows an alert, and
    the campaign is not started.
  - **Capture:** a headless browser takes one JPEG per second, which FFmpeg encodes into
    a real-time VP8 WebM. A late capture repeats frames, so wall-clock time is kept.
  - **Exports:** the 100× and 120× exports select the frame for each 30 fps output time.
  - **Verification:** every video is decoded and its frames counted before the manifest
    is written.

## Executed checks

| Location | Command | Observed result |
| --- | --- | --- |
| `apps/web/` | `npm run check`, `npm run format:check` | Passed |
| `apps/web/` | `FORGE_PYTHON=… npm test` | 6 tests passed (one recorded campaign, about 55 s) |
| `services/orchestrator/` | `npm run check`, `npm run format:check`, `FORGE_PYTHON=… npm test` | Passed; 48 tests across 10 files (233 s), with live snapshots exported during every campaign |
| `apps/web/` | `FORGE_PYTHON=… npm run record -- fixture-grpo` | Recorded campaign below |

The dashboard and recorder used the Playwright-cached Chromium headless shell and the
Playwright-cached FFmpeg 7.0.1 build (VP8/WebM only) already on this machine; no system
FFmpeg is installed. CI installs Ubuntu's FFmpeg and uses the runner's Chrome.

## Gate

| Gate requirement | Observed |
| --- | --- |
| Rendered desktop, mobile and accessibility checks | Full view at 1440×900 and 390×844, and the live view at 1440×900. No view scrolls sideways, and the live view fits the screen with every live section present. axe-core 4.14.0 reports **zero violations** in all three, in both light and dark color schemes. Its first run flagged unfocusable scroll regions, which are now labeled, focusable regions. |
| Displayed scores equal stored artifacts | The test reads the rendered values and checks them against independently read files. The baseline is the frozen report whose SHA-256 the campaign recorded. Each experiment's development score is its evaluator report. Rewarded/total rollouts are summed over every `rollouts.jsonl`. The budget is the campaign snapshot, and promotion is the final report. All matched. |
| Valid, playable source and accelerated recordings | A 51-second campaign gave a 51-frame source of 51.0 s. The 100× export has 15 frames (0.5 s) and the 120× export 12 frames (0.4 s). The decoded frame counts and hashes match the manifest, and Chromium plays all three at 1440 px. |
| Capture failure visible before campaign start | With FFmpeg unavailable, the launcher exits 2 and the campaign directory contains only `recording/`: no actors, data or experiments. The dashboard shows a `role="alert"` banner naming `FFMPEG_NOT_FOUND` and saying the campaign was not started, and the recording pill reads failed. |
| Fixtures visibly labeled | The fixture campaign shows a banner on every view, and the test asserts it. |
| Dashboard shows only stored real data | No value is computed beyond counts and sums of file contents. `/files/` returned 404 for actor storage, the Relay database, training data and a traversal attempt. |

## Recorded campaign

`npm run record -- fixture-grpo` recorded a 51-second autonomous GRPO campaign:
- **Campaign:** three experiments, 87 of 144 rollouts rewarded by the worlds, two
  governance vetoes, and no promotion.
- **Recording:** the source is 51 frames, none repeated. The exports are 15 frames at
  100× and 12 frames at 120×.
- **What the frames show:** the campaign, recording and fixture banners. During the run
  they also show new experiments, rising rollout counts and Relay messages as they
  arrive.

With one frame per second, a 100× export of a short fixture campaign is under a second
long. The exports are meant for real campaigns: the 38-minute Qwen campaign would give
about 23 s at 100× and 19 s at 120×.

The stored real Qwen GRPO campaign (`research-qwen-grpo-1793247290`) renders in the
dashboard from its files: scores, the reward curves of all three experiments, world
transitions, governance and before/after examples. It predates live snapshots, so its
agent messages and budget cap are not shown.

## Interpretation and limits

- **The recording shows the dashboard's live view, rendered headless, not the whole
  screen.** That needs no screen-recording permission, and the frames are exactly what
  the dashboard showed.
- **The recording is VP8 WebM.** It plays in browsers; QuickTime cannot play it.
- **The real Qwen campaign has not been recorded.** Doing so takes about 40 minutes,
  plus a headless browser on top of the roughly 10 GB the campaign uses.
- **Live state lags by up to 2 seconds.** Snapshots are written every 2 seconds and the
  dashboard polls at the same interval. Campaigns run before this phase have no
  snapshots.
- **The dashboard has no authentication.** It is bound to loopback for local use, and a
  deployment needs access control in front of it.
