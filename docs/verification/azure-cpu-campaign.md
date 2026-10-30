# Azure CPU campaign reproduction and prompt/length ablation

Source: commit `1e88a54`, shipped to the VM as a `git archive` and
verified by SHA-256 (`cd2d9951…e418`) before unpacking. Machine: Azure Standard_D8ps_v5
(8 Arm cores, 32 GB, no GPU), Ubuntu 24.04, centralus, no inbound ports. Stack pinned as
in CI: Python 3.11, torch 2.9.0 CPU, transformers 4.57.1, peft 0.17.1, lm_eval 0.4.9.2,
Node 22, Bun 1.4.2. `FORGE_DEVICE=cpu`. Only the pinned Qwen revision and the GSM8K
**train** file were cached for research; the test split was never fetched.

GPU compute was not used: GPU quota is zero in every region (automatic increases were
refused), and the subscription's VM-size policy permits no GPU sizes.

## Campaign: reproduced on a clean machine

`npm run research -- qwen`, 5,534 s, no human selection.

| Experiment | Development (custom scorer, 16) |
| --- | ---: |
| Baseline, Qwen2.5-0.5B-Instruct | 0/16 |
| `r1-explore-concise` | 3/16 |
| `r1-explore-full` | 4/16 |
| `r2-extend-full`, selected, approved and promoted | 6/16 |
| `r3-extend-full` (128 steps) | stopped twice at the 1-hour run budget |

Held-out regression suite: 0/16 to 6/16, approved. The director took the same path as
the Mac campaign. `r3` failed because CPU training is slower; on the Mac it scored 4/16
and was rejected, so selection is unchanged. The adapter differs bytewise from the Mac's
(`ce975570…` vs `eddf05fc…`) because CPU and MPS arithmetic differ: this is a retrained
copy of the recipe, not the original checkpoint.

## Ablation: the gain does not survive the official harness

`forge-harness ablation` on `r2-extend-full`, all four predeclared variants of
`services/training-core/examples/harness-qwen-ablation.json`, same 16 development rows.
Summary (in [evidence](evidence/azure-cpu-ablation-summary.json), SHA-256 `57754bad…747b`;
on-VM bundle `f2c1ca8e…be92`):

| Variant | Strict, base → cand | Flexible, base → cand | Cap hits (b/c) | Gate |
| --- | ---: | ---: | ---: | :---: |
| reference: zero-shot chat, 512 tokens | 0 → 0 | 9 → 6 | 0/0 | fail |
| long-cap: zero-shot chat, 1024 tokens | 0 → 0 | 9 → 6 | 0/0 | fail |
| plain-prompt: zero-shot, no chat template | 0 → 0 | 3 → 6 | 1/3 | fail |
| five-shot: no chat template | 4 → 7 | 8 → 7 | 1/0 | fail |

**Verdict: `no_gain`.** No variant passes the development release gate (a strict gain with
no flexible drop), no example gains in every variant, and the two variants in which
neither policy hit the cap show no strict gain. The longer cap changes nothing, so
truncation is not the explanation.

Mechanism, from the stored completions: fine-tuning taught the GSM8K working style
(`40 + 4 = <<40+4=44>>44`), but under the harness's zero-shot prompt the candidate ends
with "Therefore, the answer is 64." rather than `#### 64`, so strict extraction never
fires. The 6/16 came from the campaign's own scorer accepting that ending. Only when
five worked examples show the `####` format does strict accuracy rise (4 → 7), and even
then flexible accuracy falls 8 → 7 with one strict regression (`gsm8k-train-7300`).

## Release refused; no final evaluation

`forge-harness freeze` with the reference variant as harness evidence refused the
release: "Development harness release gate failed: strict gain and no flexible accuracy
drop required." No grant was issued and the sealed GSM8K test split was not read. This
is the intended outcome for a candidate whose gain is format-specific. No benchmark
improvement is claimed.

## Next research step

Train toward the harness's own answer contract rather than the custom scorer: score
development and regression with harness strict and flexible extraction during selection,
and expand to a larger disjoint train-split development set, as the earlier audit
recommended. Evidence bundles, adapters and logs remain on the deallocated VM's disk
(`forge-runs-eastus/forge-runner`, `/opt/forge-out`).
