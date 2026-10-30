# Clean-machine reproduction (test suites)

Date: 2026-10-29. Commit: `ca8bc3d`. Machine: fresh Linux x86_64 cloud container, 4 CPU
cores, 15 GB RAM, no GPU, no prior Forge state, caches or credentials. Outbound network
went through a policy proxy that denied `download.pytorch.org`, `huggingface.co` and
`management.azure.com`.

Every CI job was reproduced from a fresh clone with the commands in the workflow files.
All passed:

| Job | Commands | Result |
| --- | --- | --- |
| Command center, web | `npm ci`, `lint`, `test:relay`, `typecheck`, `format:check`, `build` | passed |
| Command center, control plane | actor generate, `ruff check`, `ruff format --check`, `pytest tests` | 66 passed, 1 skipped |
| Training core | `ruff check`, `ruff format --check`, `pytest` (offline, real CPU optimization) | 86 passed |
| Terse actors | `check`, `format:check`, `generate`, `test`, `demo` | 21 passed, demo completed |
| Orchestrator | `check`, `format:check`, `test` (real Relay, Terse, tiny-model optimization) | 48 passed |

## Deviations

- Torch 2.9.0 was installed from PyPI rather than the PyTorch CPU index, which the proxy
  denied. Same version; the PyPI wheel bundles CUDA libraries that go unused on CPU.
- Python 3.11 (training core) and 3.12 (control plane), as in CI.

## Not reproduced

This verifies the test suites only. No Qwen2.5-0.5B campaign, GSM8K harness run or sealed
final evaluation was run, because the model and dataset hosts were unreachable. Those
still require a machine with Hugging Face access. The Azure evaluator path
(`services/core/azure_final.py`) also needs `management.azure.com`.
