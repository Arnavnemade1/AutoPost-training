# Phase 4 local verification

Verified October 28, 2026 on an Apple M4 (16 GB, macOS arm64). This record concerns
evidence-driven experiment selection. Development scores below use the custom
`forge_numeric_v1` scorer on a 16-example partition of the official GSM8K **train**
file; they are not GSM8K benchmark results, and no model-superiority claim is made.

## What was built

- `ResearchLedgerActor` (Terse): director-only, append-only diagnoses, hypotheses,
  decisions with rejected alternatives, and a stop rule. It verifies cited baseline,
  evaluation and failure evidence against campaign and experiment state.
- `director-rules-v1` (`services/orchestrator/src/director.ts`): a deterministic policy
  with no model calls. It diagnoses the baseline, explores two `sft_lora` recipes (full
  and shorter-half solutions), ranks by measured results, picks a revision operator
  from what the selected candidate measured, and applies declared stop rules.
- A message-driven campaign loop: each role acts only on Relay-delivered messages.
  The reviewer approves compute only after finding the director's ledger launch and
  recomputing the recipe's data selection and configuration.

## Executed checks

| Location | Command | Observed result |
| --- | --- | --- |
| `packages/terse-actors/` | `npm run check`, `npm run format:check`, `npm run generate` | Passed; seven actor contracts |
| `packages/terse-actors/` | `npm test` | 21 tests passed across 4 files |
| `services/orchestrator/` | `npm run check`, `npm run format:check` | Passed |
| `services/orchestrator/` | `FORGE_PYTHON=… npm test` | 17 tests passed across 4 files (policy, recipes, Phase 3, Phase 4) |
| `services/orchestrator/` | `FORGE_PYTHON=… npm run research -- qwen` | Campaign below; 1,711 seconds |

The policy tests change only measurements and check that decisions change: swapped
round-one results revise a different recipe; improved, unchanged and regressed
predictions choose extend, raise-learning-rate and lower-learning-rate respectively.
Recipe tests confirm the reviewer rejects altered training rows, learning rate, step
count, template settings and evaluation protocol. The Phase 4 fixture test runs the
whole loop on the offline tiny model with real Relaycast, Terse and Python processes.

## Real campaign: Qwen2.5-0.5B-Instruct on GSM8K-train development data

Setup: model revision `7ae557604adf67be50417f59c2c2f167def9a775`; GSM8K revision
`740312add88f781978c0658806c59bc2815b9866`, official train file only, seed-42 partition
of 128 training and 16 development examples. MPS, float32, greedy decoding, 256 new
tokens. LoRA rank 8 on `q_proj`/`v_proj`, batch 1, learning rate 2e-4. Budget: four
experiments. No human selected an experiment after the campaign started.

| Ledger step | Evidence | Decision |
| --- | --- | --- |
| Diagnosis | Frozen baseline 0/16: 16 invalid final-answer format, 9 hit the token limit | Primary failure mode: length |
| Decision 1 | Baseline | Explore `concise` (prioritized by diagnosis) and `full`, 32 steps each |
| Decision 2 | Concise 3/16, full 4/16 | Select **full**; revision `extend` to 64 steps. Rejected: concise (fewer correct), raise/lower learning rate (not indicated) |
| Decision 3 | Extended full 6/16 | Select it; `extend` to 128 steps |
| Stop | 128-step run 4/16 | `NO_FURTHER_IMPROVEMENT`; development-selected candidate: 64-step full recipe |

**Gate:** measured results changed later decisions without human selection. The
diagnosis ordered the concise recipe first, but measurements selected the full recipe.
The 64-step result chose a further extension, and the 128-step result stopped the
campaign. Each decision records counterfactuals: unchanged predictions would have
raised the learning rate instead.

| Experiment | Steps | Correct | Format failures | Token-limit hits | Wilson 95% | Paired bootstrap 95% (pp) |
| --- | --- | --- | --- | --- | --- | --- |
| Baseline | — | 0/16 | 16 | 9 | — | — |
| concise | 32 | 3/16 | 7 | 3 | 6.6%–43.0% | 0.0 to 37.5 |
| full | 32 | 4/16 | 5 | 4 | 10.2%–49.5% | 6.25 to 43.75 |
| full, extended | 64 | **6/16** | 3 | 1 | 18.5%–61.4% | 12.5 to 62.5 |
| full, extended | 128 | 4/16 | 0 | 0 | 10.2%–49.5% | 6.25 to 43.75 |

No candidate regressed an example the baseline answered (the baseline answered none).
All four experiments passed preflight, used one worker attempt and were reproduced
exactly by the evaluator's separate MPS process. Each worker's in-run baseline matched
the frozen baseline. Optimization took 19–89 seconds per run; three development
evaluations per experiment dominated the runtime. Reconciliation finished clean,
the campaign is stopped, and 400,000 micro-USD were charged at the reserved upper
bound (unmeasured local cost). No checkpoint was promoted.

## Interpretation and limits

- The baseline's 0/16 is mostly a format failure: the instruct model rarely ends with
  the required `#### N` line within 256 tokens. Much of the measured gain is learning
  that format; the 128-step run fixed format entirely yet answered fewer correctly.
- Sixteen examples give wide intervals. 6/16 versus 4/16 is within noise; the stop
  rule acts on point estimates. Selecting among four candidates on the same development
  set biases the selected score upward. Only a sealed final evaluation (Phase 8) can
  estimate performance.
- The two strategies are `sft_lora` recipes differing in data and schedule; GRPO is
  Phase 6. The director is rule-based; no language-model proposer was used.
- Governance is deferred: no regression suite ran and no terminal decision was
  recorded, so these checkpoints remain eligible for Phase 5 review.
- The director's working state is in memory; the ledger and actors are durable, but a
  crashed director does not yet resume a campaign. All roles still share one process.
- The meta-device size preflight in `services/training-core` counts Qwen's tied
  embeddings twice (630,167,424 vs about 494M loaded); the campaign template sets a
  700M limit to accommodate it.
- The run's artifacts (ledger, reports, checkpoints) are under the ignored
  `services/orchestrator/artifacts/research-qwen-1793176591/` on the machine that ran it.
