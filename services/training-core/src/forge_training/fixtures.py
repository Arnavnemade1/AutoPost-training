"""An offline random tiny model for mechanics tests, never benchmark evidence."""

from __future__ import annotations

from pathlib import Path

from .artifacts import directory_sha256, write_json
from .config import Example
from .data import write_dataset


def make_smoke_fixture(output: Path) -> Path:
    import torch
    from tokenizers import Tokenizer
    from tokenizers.models import WordLevel
    from tokenizers.pre_tokenizers import Whitespace
    from transformers import GPT2Config, GPT2LMHeadModel, PreTrainedTokenizerFast

    output.mkdir(parents=True, exist_ok=False)
    model_dir = output / "base-model"
    model_dir.mkdir()
    vocabulary = ["<pad>", "<eos>", "<unk>", "Question", "Answer", ":", "####", ".", "+", "?"]
    vocabulary += [str(i) for i in range(32)]
    vocabulary += "Solve the problem End with a final line in form number What is plus".split()
    vocabulary = list(dict.fromkeys(vocabulary))
    backend = Tokenizer(
        WordLevel(dict(zip(vocabulary, range(len(vocabulary)), strict=True)), unk_token="<unk>")
    )
    backend.pre_tokenizer = Whitespace()
    tokenizer = PreTrainedTokenizerFast(
        tokenizer_object=backend,
        pad_token="<pad>",
        eos_token="<eos>",
        unk_token="<unk>",
    )
    tokenizer.save_pretrained(model_dir)
    torch.manual_seed(7)
    model = GPT2LMHeadModel(
        GPT2Config(
            vocab_size=len(vocabulary),
            n_positions=256,
            n_ctx=256,
            n_embd=32,
            n_layer=1,
            n_head=2,
            bos_token_id=tokenizer.eos_token_id,
            eos_token_id=tokenizer.eos_token_id,
            pad_token_id=tokenizer.pad_token_id,
            resid_pdrop=0.0,
            embd_pdrop=0.0,
            attn_pdrop=0.0,
        )
    )
    model.save_pretrained(model_dir, safe_serialization=True)
    data_dir = output / "data"
    data_dir.mkdir()
    for name, numbers in (("train", range(1, 5)), ("development", range(5, 7))):
        examples = [
            Example(id=f"{name}-{i}", question=f"What is {i} plus 1?", answer=f"#### {i + 1}")
            for i in numbers
        ]
        write_dataset(
            data_dir,
            name,
            examples,
            source="forge-offline-fixture",
            revision="generator-v1",
            source_split="synthetic",
            license_name="CC0-1.0",
        )
    config = {
        "campaign_id": "mechanics-smoke",
        "experiment_id": "tiny-lora",
        "model": {
            "source": "local",
            "model_status": "fixture",
            "model_id": "base-model",
            "revision": directory_sha256(model_dir),
        },
        "train": {"records": "data/train.jsonl", "manifest": "data/train.manifest.json"},
        "development": {
            "records": "data/development.jsonl",
            "manifest": "data/development.manifest.json",
        },
        "training": {
            "max_steps": 3,
            "gradient_accumulation_steps": 1,
            "max_sequence_length": 128,
            "lora_rank": 4,
            "lora_alpha": 8,
            "target_modules": ["c_attn"],
            "max_seconds": 120,
        },
        "evaluation": {"max_new_tokens": 8, "max_prompt_tokens": 128, "max_seconds": 120},
        "device": "cpu",
        "precision": "float32",
        "output_dir": "run",
    }
    config_path = output / "experiment.json"
    write_json(config_path, config)
    return config_path
