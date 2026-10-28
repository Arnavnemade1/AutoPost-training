"""Record supplementary views of actual completed evidence for the two-minute edit."""

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main(campaign_id):
    from scripts.capture import browser
    from services.core import store

    snapshot = store.get(campaign_id)
    if not snapshot or snapshot["status"] != "completed":
        raise ValueError("Supplementary footage requires a completed, preserved campaign")
    folder = store.ARTIFACTS / campaign_id / "recording"
    target = folder / "evidence-tour.webm"
    if target.exists():
        raise FileExistsError(target)
    browser("--args", "--disable-gpu", "--idle-timeout", "0", "open", "http://127.0.0.1:3000")
    browser("set", "viewport", "1440", "1000")
    browser("record", "start", str(target), "http://127.0.0.1:3000")
    began = time.monotonic()
    markers = {}
    try:
        browser("open", "http://127.0.0.1:3000")
        browser("wait", "#campaign-select")
        browser("select", "#campaign-select", campaign_id)
        browser(
            "wait",
            "--fn",
            f"document.querySelector('.page-footer')?.innerText.includes({json.dumps(campaign_id)})",
        )
        browser("find", "role", "button", "click", "--name", "Results", "--exact")
        browser("wait", "--text", "Read the model's work")
        browser("scrollintoview", ".paired-predictions article:first-child")
        markers["comparison"] = time.monotonic() - began
        time.sleep(18)
        browser("find", "role", "button", "click", "--name", "Governance", "--exact")
        browser("wait", "--text", "Put the gate to the test")
        browser(
            "eval",
            "Array.from(document.querySelectorAll('.review-list article')).find(e => e.innerText.includes('Controlled integrity probe'))?.scrollIntoView({block:'center'})",
        )
        markers["governance"] = time.monotonic() - began
        time.sleep(24)
        browser("find", "role", "button", "click", "--name", "Artifacts", "--exact")
        browser("wait", "--text", "Evidence registry")
        markers["artifacts"] = time.monotonic() - began
        time.sleep(18)
    finally:
        browser("record", "stop")
        browser("close")
    (folder / "evidence-tour.json").write_text(
        json.dumps(
            {
                "campaign_id": campaign_id,
                "recorded_at": store.now(),
                "markers": markers,
                "purpose": "Historical views of actual completed evidence. No training is rerun or simulated.",
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--campaign", required=True)
    main(parser.parse_args().campaign)
