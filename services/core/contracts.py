from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

MODEL_ID = "Qwen/Qwen2.5-0.5B-Instruct"
MODEL_REVISION = "7ae557604adf67be50417f59c2c2f167def9a775"


class CampaignConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(default="Mathematical reasoning", min_length=3, max_length=80)
    model_id: Literal["Qwen/Qwen2.5-0.5B-Instruct"] = MODEL_ID
    benchmark: Literal["gsm8k-subset"] = "gsm8k-subset"
    final_backend: Literal["shared_scorer", "lm_eval_azure"] = "shared_scorer"
    objective: str = Field(
        default="Improve multi-step mathematical reasoning without benchmark leakage.",
        min_length=10,
        max_length=500,
    )
    max_seconds: int = Field(default=1800, ge=120, le=14400)
    max_experiments: int = Field(default=2, ge=1, le=4)
    train_steps: int = Field(default=24, ge=4, le=200)
    dev_samples: int = Field(default=12, ge=4, le=100)
    final_samples: int = Field(default=12, ge=4, le=100)
    seed: int = Field(default=42, ge=0, le=2147483647)
    strategies: list[Literal["broad_sft", "targeted_sft", "grpo"]] = Field(
        default_factory=lambda: ["broad_sft", "targeted_sft"], min_length=1
    )


class Message(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    campaign_id: str
    sender: Literal["director", "data", "trainer", "evaluator", "governance"]
    recipient: Literal["director", "data", "trainer", "evaluator", "governance"]
    category: str
    text: str
    experiment_id: str | None = None


class Action(BaseModel):
    model_config = ConfigDict(extra="forbid")
    episode_id: str
    action_id: str = Field(min_length=1, max_length=100)
    expected_version: int = Field(ge=0)
    answer: str = Field(max_length=100)
