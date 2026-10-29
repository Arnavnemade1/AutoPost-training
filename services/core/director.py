"""A bounded, evidence-driven research decision. Final test data is never passed here."""

import json
import os
from typing import Literal
import httpx
from pydantic import BaseModel, ConfigDict, Field


class Proposal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    strategy: Literal["broad_sft", "targeted_sft", "grpo"]
    learning_rate: float = Field(ge=0.00001, le=0.001)
    lora_rank: Literal[8, 16]
    hypothesis: str = Field(min_length=10, max_length=1000)
    focus: Literal["arithmetic", "multi_step", "formatting", "general"]


def build_input(config, development, previous):
    return {
        "objective": config["objective"],
        "development_score": development["score"],
        "failures": [
            {"question": p["question"], "prediction": p["output"], "expected": p["expected"]}
            for p in development["predictions"]
            if not p["correct"]
        ][:6],
        "previous_experiments": previous,
    }


def propose(config, development, previous, context=None):
    failures = [p for p in development["predictions"] if not p["correct"]]
    fallback = {
        "strategy": "broad_sft" if not previous else "targeted_sft",
        "learning_rate": 0.0002 if not previous else 0.0001,
        "lora_rank": 8,
        "hypothesis": f"{len(failures)} of {development['n']} development answers are incorrect. Train verified worked examples, then compare an independently loaded adapter.",
        "focus": "general" if not previous else "multi_step",
    }
    if fallback["strategy"] not in config["strategies"]:
        fallback["strategy"] = config["strategies"][0]
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT") or "https://api.openai.com/v1"
    key = os.getenv("AZURE_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not key:
        return Proposal.model_validate(fallback).model_dump() | {"director": "Evidence-driven local director"}
    schema = {
        "type": "object",
        "properties": {
            "strategy": {"type": "string", "enum": config["strategies"]},
            "learning_rate": {"type": "number"},
            "lora_rank": {"type": "integer", "enum": [8, 16]},
            "hypothesis": {"type": "string"},
            "focus": {"type": "string", "enum": ["arithmetic", "multi_step", "formatting", "general"]},
        },
        "required": ["strategy", "learning_rate", "lora_rank", "hypothesis", "focus"],
        "additionalProperties": False,
    }
    payload = {
        "model": os.getenv("FORGE_DIRECTOR_MODEL", "gpt-5-mini"),
        "max_output_tokens": 2000,
        "instructions": "You are Forge's research director. Choose ONE bounded LoRA experiment based on measured development evidence. You cannot change the objective, reward or benchmark. Never ask for final test data. Use only allowed strategies. broad_sft trains the permitted corpus; targeted_sft reweights its longer multi-step examples. If grpo is allowed, it uses 8 TRL steps with deterministic Terse rewards. Begin with SFT to learn answer format, then compare GRPO after a valid SFT candidate. GRPO warm-starts the best approved SFT adapter, so its lora_rank MUST match that candidate's recorded rank. Return a concrete hypothesis. Prefer a different strategy when prior experiments fail. Learning rate 1e-5 to 1e-3, rank 8 or 16.",
        "input": json.dumps(context if context is not None else build_input(config, development, previous)),
        "text": {
            "format": {"type": "json_schema", "name": "experiment_proposal", "strict": True, "schema": schema}
        },
    }
    headers = {"api-key": key} if os.getenv("AZURE_OPENAI_API_KEY") else {"Authorization": f"Bearer {key}"}
    r = httpx.post(endpoint.rstrip("/") + "/responses", headers=headers, json=payload, timeout=90)
    r.raise_for_status()
    raw = r.json()
    chunks = [
        c["text"]
        for o in raw.get("output", [])
        for c in o.get("content", [])
        if c.get("type") == "output_text"
    ]
    if not chunks:
        raise RuntimeError("Research director returned no structured proposal")
    proposal = Proposal.model_validate_json("".join(chunks)).model_dump()
    if proposal["strategy"] not in config["strategies"]:
        raise ValueError("Director selected an unauthorized strategy")
    return proposal | {
        "director": f"Azure OpenAI · {payload['model']}",
        "response_id": raw["id"],
        "usage": raw.get("usage"),
    }
