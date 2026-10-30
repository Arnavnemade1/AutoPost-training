# Logos on `/site`

The "Built with" strip shows only software Forge depends on, using each project's own
mark. Every file in `public/site/logos/` was downloaded on 2026-10-29 from the source
below and recolored to one neutral grey (`#6b6b6b`, 5.3:1 on white). Geometry is
unchanged: no path was drawn or edited.

| Logo | File | Source | Where Forge uses it |
| --- | --- | --- | --- |
| PyTorch | `pytorch.svg` | https://pytorch.org/wp-content/uploads/2024/10/logo.svg (site header) | `torch==2.14.1` in `pyproject.toml` |
| Hugging Face | `huggingface.svg` | Mark: https://huggingface.co/datasets/huggingface/brand-assets/resolve/main/hf-logo-monochrome.svg; wordmark path and layout: `hf-logo-with-title.svg` from the same brand-assets dataset (linked from https://huggingface.co/brand) | `transformers`, `peft` and `datasets` in `pyproject.toml`; the model and GSM8K load from the Hugging Face Hub (`from_pretrained`, `load_dataset`) |
| Qwen | `qwen.svg` | simple-icons 16.30.0, https://cdn.jsdelivr.net/npm/simple-icons@16.30.0/icons/qwen.svg | Model `Qwen/Qwen2.5-0.5B-Instruct` (`services/core/contracts.py`) |
| EleutherAI | `eleutherai.svg` | https://eleuther.ai/assets/eleutherai-logo.svg (site header) | `lm-eval[hf]==0.4.13` (EleutherAI evaluation harness) in `pyproject.toml` |
| Agent Relay | `agent-relay.svg` | The two inline SVGs of the site header at https://agentrelay.com (`site-nav_logoIcon`, `site-nav_logoWordmark`), placed side by side at the wordmark's height | `@agent-relay/sdk` 14.0.0 in `package.json` |
| Durable Actors by Terse | `terse-durable-actors.png` | https://mintcdn.com/terse/ZDX6omvUazOLSJzk/logo/durable-actors_primary-lockup_positive.png (logo of https://docs.useterse.ai), cropped to its bounds; alpha set from darkness so the line art stays and the fills drop out | `durable-actors[cli]==0.14.0` in `pyproject.toml`, `packages/terse-actors` |

Dropped: GSM8K (a dataset) and LoRA (a technique) have no logo. The Qwen site's own
logo (https://qwenlm.github.io/img/logo.png) is a full-color raster with white inner
strokes that do not survive a one-color treatment, so the simple-icons monochrome mark is used.
