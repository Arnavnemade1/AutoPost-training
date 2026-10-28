"""Export faithful, playable full-speed and accelerated versions of the actual capture."""

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def inspect(path):
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_name,width,height",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def render(campaign_id):
    from dotenv import load_dotenv
    from services.core import store
    from services.core.engine import artifact
    from services.core.cloud import mirror
    from forge_training.artifacts import file_sha256

    load_dotenv(ROOT / ".env")
    folder = store.ARTIFACTS / campaign_id / "recording"
    source = folder / "training_raw.webm"
    manifest = json.loads((folder / "capture-manifest.json").read_text())
    if not manifest.get("full_lifecycle") or not manifest.get("terminal_state_observed"):
        raise ValueError("An incomplete capture cannot be exported as a full research-session recording")
    original = inspect(source)
    duration = float(original["format"]["duration"])
    if duration < 1 or original["streams"][0]["width"] < 1280:
        raise ValueError("The source recording failed its duration or resolution check")
    commands, outputs = [], []
    for speed, name in [(1, "training_raw.mp4"), (100, "training_100x.mp4"), (120, "training_120x.mp4")]:
        target = folder / name
        if target.exists():
            raise FileExistsError(f"Preserve existing recording: {target}")
        command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "warning",
            "-n",
            "-i",
            str(source),
            "-an",
            "-vf",
            f"setpts=(PTS-STARTPTS)/{speed},fps=30",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(target),
        ]
        subprocess.run(command, check=True)
        result = inspect(target)
        actual = float(result["format"]["duration"])
        if abs(actual - duration / speed) > max(0.2, duration / speed * 0.002):
            raise ValueError(f"Unexpected video speed or duration: {name}")
        outputs.append({"file": name, "speed": speed, "sha256": file_sha256(target), "probe": result})
        commands.append(command)
    movie_manifest = {
        "campaign_id": campaign_id,
        "source_sha256": file_sha256(source),
        "capture_started_at": manifest["started_at"],
        "capture_ended_at": manifest["ended_at"],
        "full_lifecycle": manifest["full_lifecycle"],
        "source": "Unmodified continuous live browser recording, 1440 by 1000",
        "transformation": "Time rescaling and 30fps export; accelerated versions drop frames, never synthesize activity.",
        "commands": commands,
        "outputs": outputs,
    }
    (folder / "video-manifest.json").write_text(json.dumps(movie_manifest, indent=2))
    for name, title in [
        ("training_raw.webm", "Original live screen recording"),
        ("training_raw.mp4", "Full-speed training recording"),
        ("training_100x.mp4", "Training recording at 100×"),
        ("training_120x.mp4", "Training recording at 120×"),
        ("capture-manifest.json", "Capture timestamps and stage markers"),
        ("video-manifest.json", "Video provenance and export commands"),
    ]:
        artifact(campaign_id, folder / name, "recording", title)
    store.patch(
        campaign_id,
        lambda s: s.update(recording={"status": "saved", "artifact_path": "recording/training_raw.mp4"}),
    )
    mirror(campaign_id)
    print(json.dumps({"campaign_id": campaign_id, "source_seconds": duration, "exports": outputs}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--campaign", required=True)
    render(parser.parse_args().campaign)
