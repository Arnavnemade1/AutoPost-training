# Training on a Modal H100

`FORGE_BACKEND=modal` runs a campaign's model work (baseline, training, every
evaluation, the sealed final) on an NVIDIA H100 on Modal. Everything else stays on this
machine: the runner, Terse actors, Agent Relay, the director, governance and the command
center. `FORGE_BACKEND=local` (the default) is unchanged.

## How it works

| Piece | Where |
| --- | --- |
| Backend switch, same inputs and outputs as `training.*` | `services/core/compute.py` |
| Modal app, image, weights Volume, GPU function | `services/core/remote.py` |
| Shared, torch-free evaluation protocol | `services/core/protocol.py` |
| Call sites | `services/core/runner.py` (`backend.load/evaluate/train/unload`) |

- **Same data both ways.** The runner prepares rows locally exactly as before. Rows, and
  adapter bytes for checkpoint evaluation, go to the GPU. Predictions (with
  `finish_reason`), training metrics, adapter files and SHA-256s come back. Checkpoints
  are written to the same `artifacts/<campaign>/<exp>/` folder, so governance, artifacts,
  Download checkpoint and the command center work unchanged. Adapter checksums are
  verified on both sides of the transfer.
- **Live progress.** The GPU function streams each prediction and training metric through
  a `modal.Queue`. Terse worlds, `evaluation_sample` events and briefing progress are
  produced locally as they arrive.
- **Stop.** A stop request cancels the GPU call and terminates its container. Each
  campaign worker owns one ephemeral Modal app, closed when the worker ends (also on the
  deadline SIGTERM), so no deployed endpoint or idle GPU is left running.
- **Pinned.** Model revision, dataset revision and package versions match `uv.lock`.
  Weights are cached in the `forge-hf-cache` Volume, so cold starts do not re-download.
- **Same protocol.** Greedy decoding, batch size 1, `max_new_tokens=256`, float16.
  Batched decoding on the H100 changed 8 of 8 smoke-test outputs, so it is not used.
- **Provenance.** Every evaluation and `training.json` records the device that ran it,
  from `torch.cuda.get_device_name` (`NVIDIA H100 80GB HBM3`). The campaign bar, the
  briefing's execution strip and the experiment configuration show it.
- **Failure.** If Modal is unreachable or unauthenticated the campaign fails with
  `Modal H100 backend unavailable: ...`. It runs locally instead only when
  `FORGE_BACKEND_FALLBACK=local` is set, and records that in its events. GRPO is
  local-only; the API rejects GRPO campaigns when the backend is Modal.

## Use it

```sh
uv sync --extra modal
.venv/bin/modal token new              # once; stored in ~/.modal.toml
FORGE_BACKEND=modal .venv/bin/python scripts/modal-smoke.py   # a few cents of GPU time
FORGE_BACKEND=modal npm run lab
```

`FORGE_MODAL_GPU` picks another Modal GPU type (default `H100`). A second lab can run
beside the default one on other ports: Terse `--port` plus
`DURABLE_ACTORS_CONTROL_PLANE_URL`, the Relay server's port argument plus
`FORGE_RELAY_URL`, `FORGE_RELAY_BRIDGE`, `FORGE_API_URL` and `FORGE_WEB_PORT` for the
API, and `PORT`/`--port` for Next.

## Measured (October 29, 2026)

Smoke test (`scripts/modal-smoke.py 8 8`): cuda, `NVIDIA H100 80GB HBM3`, torch
2.14.1+cu130; 8 development rows in 28.0 GPU seconds (3.5 s per row); 8 training steps,
loss 0.967 to 0.542, parameter hash `1c5ed0e6...` to `f16597c4...`, adapter SHA-256
identical on Modal and locally, and identical across two runs.

Production campaign `forge-41e5ddc7` (the "Train on these failures" configuration:
targeted_sft + broad_sft, 2 experiments, 96 steps, 24 development and 24 final
questions, scan `scan-d2f134cd`), Azure OpenAI director, every phase on the H100:

| | Apple M3 `forge-011e8b59` | Modal H100 `forge-41e5ddc7` |
| --- | --- | --- |
| Held-out production failures fixed | 0/33 to 8/33, validated | 0/33 to 8/33, validated |
| Sealed final | 0/24 to 6/24, validated | 1/24 to 10/24, validated (+37.5 pp, 95% [20.8, 58.3]) |
| Selected checkpoint | | exp-002 broad_sft, lr 1e-4, rank 16 |
| Regressions | | 4/4 arithmetic checks (baseline 3/4); 0 sealed questions regressed |
| Wall time | 12:41 | 19:08 |
| Baseline (24 dev + 4 regression + 33 production) | 3:55 | 4:57 |
| exp-001 train / evaluate | 0:45 / 2:28 | 0:44 / 6:03 |
| exp-002 train / evaluate | 0:39 / 2:10 | 0:44 / 3:09 |
| Sealed final (both models) | 2:25 | 3:14 |

Read this table carefully:

- **The H100 is not faster for this workload.** Evaluation is greedy decoding of a 0.5B
  model one question at a time, which is bound by per-token Python dispatch, not by GPU
  compute. On the identical untrained model and rows the H100 took 117.8 s for the 24
  development questions (M3: 101.6 s) and 155.7 s for the 33 production questions
  (M3: 129.1 s). With Modal's default fractional CPU it was 17 s per row; reserving 8
  cores brought it to 3.5 to 5 s per row. Training 96 single-example steps takes about the same
  time on both.
- **The director chose differently.** It is a model, not a fixed policy. The H100 run's
  exp-001 used learning rate 2e-5 (the M3 run used 1e-4). That checkpoint fixed nothing
  and wrote 25 of 33 production answers to the 256-token limit, which is why its
  evaluation took 6 minutes.
- **The sealed sets differ.** Each campaign draws final questions that no earlier
  campaign in the store has seen, so the two sealed results are on different 24-question
  subsets and are not a paired comparison.
- **Cost.** The whole task (image builds, two smoke tests, this campaign) metered $1.88
  on Modal.
