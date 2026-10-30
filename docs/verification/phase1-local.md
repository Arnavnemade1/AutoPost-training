# Initial training-core verification

Observed locally. These are implementation
checks, not a successful autonomous research campaign or an official benchmark claim.

Final local checks: **35 tests passed**, Ruff lint and formatting passed, and `pip check`
reported no dependency conflicts. The latest offline smoke run verified 20 preserved
artifacts, including input snapshots, replay configuration, and environment identity.

## Offline mechanics

An offline randomly initialized tiny GPT-2 completed three genuine AdamW/LoRA optimizer
steps on synthetic arithmetic. Trainable-weight hashes changed, safetensors adapter
weights were saved, and a separate process reconstructed the base and evaluated the
saved adapter. The run's two-example diagnostic remained 0/2 before and after, as
expected for a random tiny fixture. The artifact manifest verified successfully.

The automated suite also verifies repeatable fresh-process predictions, completion
and padding masks (including EOS), checksum failures, train/development overlap,
strict configuration, score-inflation rejection, decoding-setting mismatch,
token-budget failure, subprocess deadlines, model-size preflight, exclusive output
directories, portable input snapshots/replay, and source/runtime-change detection.

## Real pretrained-model pathway

| Field | Observed value |
| --- | --- |
| Model | `Qwen/Qwen2.5-0.5B-Instruct` |
| Model revision | `7ae557604adf67be50417f59c2c2f167def9a775` |
| Data | `openai/gsm8k`, official train file only |
| Dataset revision | `740312add88f781978c0658806c59bc2815b9866` |
| Research partition | 32 train examples, 8 development examples, seed 42 |
| Device / precision | Apple MPS / float32 |
| Method | SFT LoRA, rank 8, alpha 16, `q_proj` and `v_proj` |
| Optimization | Four actual optimizer steps, learning rate 0.0001 |
| Trainable parameters | 540,672 |
| Consumed training tokens | 847 |
| Weight change | Before/after trainable-weight hashes differ |
| Training elapsed | About 10.37 seconds |
| Total experiment elapsed | About 238.93 seconds, including two fresh-process evaluations |
| Development baseline | 0/8 under `forge_numeric_v1` |
| Development candidate | 0/8 under identical settings |
| Observed improvement | **0 percentage points; no improvement demonstrated** |
| Generation limit | 256 new tokens; 4/8 examples reached the limit in both evaluations |
| Formatting diagnosis | 8/8 failed the requested final-answer format in both evaluations |
| Accuracy Wilson 95% interval | Approximately [0%, 32.44%] for each score |
| Governance / promotion | Unreviewed / not authorized |
| Monetary cost | Unmeasured (`null`); no cloud compute was provisioned |

Candidate checkpoint directory SHA-256:

```text
dae3c4babd865123cf4f064a847dc0d547bb65ae38098337ebdbd22d8b0b203f
```

Run-manifest SHA-256:

```text
7e51315ac3897e3d355cf21503b080ccddc30eebb9707627854a35c646f076eb
```

Local evidence is preserved under the Git-ignored
`services/training-core/artifacts/verification/qwen-local-mps/`: source data/manifests,
partition indices, configuration, logs, predictions, actual adapter weights, and the
run manifest. The original run predates the later portable-input snapshots and
source-fingerprint improvements; its artifact set is preserved unchanged. Its outer
`experiment.json` remains relative to that evidence folder for standalone replay.

This small run proves that a real pretrained model loads, real training updates
weights, the saved checkpoint reloads, and before/after evidence is produced. Its
strict-format failures and short generation budget make it unsuitable for a capability
claim. A later study must fix and freeze the evaluation protocol, use a sufficient
development sample, compare meaningful strategies, run regression checks, then use
the protected final harness after checkpoint selection freezes.

During the first loader investigation, the generic Hugging Face named-dataset builder
prepared both train and test files despite `split="train"`. No test questions were
inspected or supplied to model generation. The loader was replaced with an explicit
pinned training-file download, verified in an actual preparation run and a regression
test. Permission-level isolation of the final evaluator remains a separate phase.

## Remaining acceptance gates

- A measured, reproducible improvement on a suitable development protocol.
- Official pinned benchmark-harness evaluation with sealed final access.
- Terse state, environment transitions, concurrency, and restart verification.
- Consequential Agent Relay assignments and research-agent decisions.
- Independent policy enforcement, rejected-checkpoint recovery, and regression tests.
- Real actor-reward-driven RL updates, dashboard, screen recording, and demo packaging.

The scoped CI workflow is written but has not run on GitHub. No push, pull request,
deployment, or public submission was performed by this workstream.
