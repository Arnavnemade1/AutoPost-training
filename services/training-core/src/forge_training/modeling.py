"""Only approved local/Hub weights; remote model code and pickle weights are disabled."""

from __future__ import annotations

import hashlib
import random
from pathlib import Path

from .artifacts import directory_sha256
from .config import ExperimentConfig

PROMPT_VERSION = "math_completion_v1"
PROMPT_INSTRUCTION = "Solve the problem. End with a final line in the form #### <number>."


def seed_everything(seed: int) -> None:
    import numpy as np
    import torch

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    # Best effort only. Different devices/kernels may still produce different results.
    torch.use_deterministic_algorithms(True, warn_only=True)


def validate_device(config: ExperimentConfig) -> None:
    import torch

    if config.device == "cuda" and not torch.cuda.is_available():
        raise ValueError("CUDA was requested but is unavailable")
    if config.device == "mps" and not torch.backends.mps.is_available():
        raise ValueError("MPS was requested but is unavailable")
    if config.device == "mps" and config.precision == "bfloat16":
        raise ValueError("Use float32 for this version's MPS pathway")
    if config.device == "cuda" and config.precision == "bfloat16":
        if not torch.cuda.is_bf16_supported():
            raise ValueError("This GPU does not support bfloat16")


def load_base(config: ExperimentConfig):
    import torch
    from accelerate import init_empty_weights
    from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer

    validate_device(config)
    if config.model.source == "local":
        if directory_sha256(Path(config.model.model_id)) != config.model.revision:
            raise ValueError("Local base-model checksum mismatch")
    kwargs = {"trust_remote_code": False, "local_files_only": config.model.source == "local"}
    if config.model.source == "hub":
        kwargs["revision"] = config.model.revision
    architecture = AutoConfig.from_pretrained(config.model.model_id, **kwargs)
    # Count parameters on the meta device before allocating/downloading real weights.
    with init_empty_weights():
        skeleton = AutoModelForCausalLM.from_config(architecture, trust_remote_code=False)
    if sum(parameter.numel() for parameter in skeleton.parameters()) > config.max_model_parameters:
        raise ValueError("Model exceeds configured parameter limit before weight loading")
    del skeleton
    tokenizer = AutoTokenizer.from_pretrained(config.model.model_id, **kwargs)
    if tokenizer.eos_token_id is None:
        raise ValueError("The approved tokenizer must define an EOS token")
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        config.model.model_id,
        **kwargs,
        use_safetensors=True,
        torch_dtype=getattr(torch, config.precision),
        attn_implementation="eager",
    )
    if sum(parameter.numel() for parameter in model.parameters()) > config.max_model_parameters:
        raise ValueError("Model exceeds configured parameter limit")
    model.to(config.device)
    return model, tokenizer


def prompt_for(tokenizer, question: str) -> str:
    content = f"{PROMPT_INSTRUCTION}\n\n{question}"
    if tokenizer.chat_template:
        return tokenizer.apply_chat_template(
            [{"role": "user", "content": content}],
            tokenize=False,
            add_generation_prompt=True,
        )
    return f"Question: {content}\nAnswer:"


def parameter_sha256(model) -> str:
    """Hash trainable tensor bytes, including names/shapes, before and after optimization."""
    import torch

    digest = hashlib.sha256()
    for name, parameter in sorted(model.named_parameters()):
        if parameter.requires_grad:
            digest.update(name.encode())
            digest.update(str(tuple(parameter.shape)).encode())
            digest.update(str(parameter.dtype).encode())
            tensor = parameter.detach().contiguous().cpu().view(torch.uint8)
            digest.update(tensor.numpy().tobytes())
    return digest.hexdigest()
