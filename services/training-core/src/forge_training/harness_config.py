"""A bounded, explicit protocol, separate from the research worker's custom scorer."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

from .config import Contract

HARNESS_VERSION = "0.4.9.2"
GSM8K_REVISION = "740312add88f781978c0658806c59bc2815b9866"


class HarnessProtocol(Contract):
    harness_version: Literal["0.4.9.2"] = HARNESS_VERSION
    task: Literal["gsm8k"] = "gsm8k"
    # Both primary and secondary metrics are declared BEFORE looking at results.
    primary_metric: Literal["exact_match,strict-match"] = "exact_match,strict-match"
    secondary_metric: Literal["exact_match,flexible-extract"] = "exact_match,flexible-extract"
    num_fewshot: Annotated[int, Field(ge=0, le=5)] = 5
    apply_chat_template: bool = False
    max_new_tokens: Annotated[int, Field(ge=1, le=1024)] = 512
    max_prompt_tokens: Annotated[int, Field(ge=32, le=4096)] = 2048
    # No automatic batch-size search or simultaneous baseline/candidate models.
    batch_size: Literal[1] = 1
    seed: Annotated[int, Field(ge=0, le=2**32 - 1)] = 42
    device: Literal["cpu", "mps", "cuda"] = "cpu"
    precision: Literal["float32", "bfloat16"] = "float32"
    # Match the existing Qwen profile: its meta skeleton counts tied embeddings twice.
    max_model_parameters: Annotated[int, Field(ge=1, le=700000000)] = 700000000


class ResourceLimits(Contract):
    max_seconds_per_model: Annotated[int, Field(ge=1, le=86400)] = 1800
    max_process_gib: Annotated[float, Field(gt=0, le=12)] = 5.0
    min_available_gib: Annotated[float, Field(ge=0.25)] = 2.0
    max_swap_growth_gib: Annotated[float, Field(ge=0)] = 0.5
    min_disk_free_gib: Annotated[float, Field(ge=1)] = 8.0
    max_output_mib: Annotated[int, Field(ge=1, le=2048)] = 256
    mps_memory_fraction: Annotated[float, Field(gt=0, le=0.45)] = 0.3
