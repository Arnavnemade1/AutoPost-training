# Forge research command center

A loopback dashboard for one campaign directory, and a recorder that captures it while a
campaign runs. It reads stored files only: the actor snapshots a campaign exports
(`live/state.json`, written every 2 seconds by `services/orchestrator/scripts/research.ts`),
the final report and ledger, run bundles, evaluator reports, governance evidence, cost
records and recordings. It holds no actor credentials and computes nothing a file does not
state; each score names its file and SHA-256.

## Run

Requires the orchestrator and actor packages installed (see their READMEs), the training
core virtualenv, Chrome or Chromium, and FFmpeg with a VP8 encoder. Discovery order:
`FORGE_CHROME`, a Playwright headless shell, installed Chrome or Chromium; `FORGE_FFMPEG`,
`ffmpeg` on `PATH`, Playwright's bundled FFmpeg. Nothing is downloaded.

```sh
cd apps/web
npm ci
npm run check
npm run format:check
FORGE_PYTHON=/absolute/path/to/training-core/.venv/bin/python npm test
npm run serve -- /path/to/campaign-directory
FORGE_PYTHON=/absolute/path/to/training-core/.venv/bin/python npm run record -- fixture-grpo
FORGE_PYTHON=... FORGE_HARNESS_PYTHON=... npm run record -- fixture-final -- --finalize
```

`serve` prints a URL for the full dashboard and its one-screen live view (`?view=live`).
`record` creates a campaign directory under `services/orchestrator/artifacts/`, serves it,
starts the recorder, and only then starts the campaign (arguments after `--` go to
`research.ts`, for example `-- --start-adapter <dir>`). A recorder that cannot start
writes `recording/state.json` with the reason, the dashboard shows it as an alert, and
the campaign is not started (exit 2) unless `--allow-unrecorded` is given. After a
finalized campaign (`-- --finalize`) and a complete recording, `record` builds the Phase 8
evidence bundle (`final/bundle/`, see the orchestrator README); the recording manifest
names the campaign and the hash of its final `live/state.json`, which the bundle's
recording check compares.

## Dashboard

| Section | Source |
| --- | --- |
| Headline tiles | frozen baseline report (by the hash the campaign recorded), evaluator reports, ledger stop entry, rollout files, campaign budget snapshot |
| Research graph | research ledger entries and their parents |
| Experiments | ledger launches, experiment snapshots, preflight reviews, evaluator reports, governance bundles |
| Training metrics | `training-metrics.jsonl` per run: share of rollouts the worlds rewarded, per update |
| Environment inspector | `rollouts.jsonl`: completions, submitted answers, rewards, world episodes |
| Governance | evidence bundles: checks, reasons, held-out suite, world-journal counts |
| Final evaluation | `FinalEvaluationActor` snapshot (freeze, bound release), `final/outcome.json`, training-core harness comparisons (`final/development`, `final/rehearsal`, `final/evaluation`), `final/final-record.json`, bundle `checks.json` |
| Before and after | baseline and development-selected candidate predictions per example |
| Agent messages | the durable workflow outbox: kind, route, Relay delivery and acknowledgement |
| Recording and downloads | recording state and verified exports; evidence files with sizes and hashes |

Fixture campaigns carry a visible banner. Charts use the validated reference palette with
a legend, selective end labels, a keyboard-reachable crosshair readout and a table view;
light and dark schemes are both styled. `/files/` serves only the evidence files the
dashboard lists, never actor storage, Relay databases or datasets.

## Recording

The recorder renders the live view in a headless browser at 1440×900 and captures one
JPEG per second. FFmpeg encodes them in real time into `recording/source.webm` (VP8); a
late capture repeats the previous frame for each missed second, so the source keeps
wall-clock time, and `recording/frames.jsonl` records every frame's time, hash and whether
it is a repeat. The 100× and 120× exports select the frame for each 30 fps output time
and are encoded by FFmpeg. Before `recording/manifest.json` is written, every video is
decoded and its frames counted against the expected number; the manifest records hashes,
durations, frame counts, the capture method and the FFmpeg build.

The recording is of the dashboard as rendered, not of the whole screen: a headless
capture needs no screen-recording permission and records exactly what the dashboard
showed. The source frames are deleted after verified export (`keepFrames` keeps them).
