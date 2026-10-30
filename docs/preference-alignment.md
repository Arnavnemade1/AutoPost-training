# Preference alignment (DPO)

For chat-preference tasks, Forge aligns the model to preferred over rejected replies with
direct preference optimization. Each row is a prompt with a chosen and a rejected reply,
uploaded as a preference [task pack](task-packs.md).

## Training

`services/core/preference.py` `train_dpo` runs TRL 1.16's `DPOTrainer` on a LoRA adapter:

- **Data:** conversational format, so the prompt renders with the same chat template and task
  instruction as evaluation.
- **Settings:**
  - sigmoid loss with `beta` 0.1
  - batch size 1 with gradient accumulation of 2
  - at most 768 tokens per example
  - the campaign's step budget
- **Reference model:** the base model with the adapter disabled, so no second copy is loaded.
- **Learning rate:** capped at 1e-4. A clamped value is recorded beside the requested one.
- **Warm start:** from the best approved SFT adapter, requiring the same LoRA rank, as for GRPO.
- **Records:** metrics include TRL's reward accuracy and margin. Parameter hashes before and
  after prove the weights changed; a run with no change is rejected.

`broad_sft` on a preference task trains the chosen replies, a common first step before DPO. DPO
and preference evaluation run on the local backend only.

## Evaluation

The primary metric is **held-out preference accuracy**: for each development or sealed pair,
whether the model gives the chosen reply a higher mean per-token log-probability than the
rejected one, given the prompt. This metric:

- is deterministic and needs no judge or API spend
- has a meaningful baseline, since the untrained model already prefers one reply or the other
  (DPO's own implicit reward margin is zero at baseline, so it cannot serve as the primary
  metric)
- gives a per-example `correct`, so the paired-bootstrap verdict, the development-only selection
  and the one-time sealed evaluation work exactly as for every other task

Each prediction records both log-probabilities, their margin and the token counts.

## Limits

- Preference accuracy measures ranking of given replies, not the quality of what the model now
  generates. A judge win-rate on generated replies would complement it; it is not implemented.
- The general retention check for uploaded packs is the four GSM8K arithmetic questions, a
  narrow signal for chat models.
