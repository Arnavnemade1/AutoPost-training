"""Start the complete local lab, reusing healthy services and owning only new processes."""

import os
import signal
import subprocess
import sys
import time
from pathlib import Path
import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
children = []
logs = []
(ROOT / "data").mkdir(exist_ok=True)
settings = dotenv_values(ROOT / ".env")


def healthy(url):
    try:
        return httpx.get(url, timeout=1).status_code < 500
    except httpx.HTTPError:
        return False


def start(name, cmd, url):
    if healthy(url):
        print(f"{name}: using existing service", flush=True)
        return
    log = (ROOT / "data" / f"{name}.log").open("a")
    logs.append(log)
    child = subprocess.Popen(cmd, cwd=ROOT, stdout=log, stderr=log, start_new_session=True)
    children.append(child)
    for _ in range(90):
        if child.poll() is not None:
            raise RuntimeError(f"{name} failed. Read data/{name}.log")
        if healthy(url):
            print(f"{name}: ready", flush=True)
            return
        time.sleep(1)
    raise TimeoutError(f"{name} did not become ready")


try:
    start(
        "terse",
        [
            str(ROOT / ".venv/bin/durable-actors"),
            "dev",
            "--project",
            "services/actors",
            "--data-dir",
            str(Path(settings.get("FORGE_TERSE_DATA_DIR") or ROOT / "data/terse").resolve()),
            "--no-watch",
        ],
        "http://127.0.0.1:7100",
    )
    subprocess.run(
        [str(ROOT / ".venv/bin/durable-actors"), "generate", "--out-dir", "services/actors/generated"],
        check=True,
    )
    start(
        "relaycast",
        [
            "node",
            "node_modules/@relaycast/engine/dist/bin/serve.js",
            "--port",
            "7528",
            "--db",
            "data/relaycast.db",
            "--env",
            "test",
        ],
        "http://127.0.0.1:7528",
    )
    start("relay-bridge", ["node", "services/relay/bridge.mjs"], "http://127.0.0.1:7529/health")
    start(
        "api",
        [sys.executable, "-m", "uvicorn", "services.api:app", "--host", "127.0.0.1", "--port", "8000"],
        "http://127.0.0.1:8000/health",
    )
    start("web", ["npm", "run", "dev"], "http://127.0.0.1:3000")
    print(
        "\nForge is ready: http://127.0.0.1:3000\nCtrl+C stops only services started by this command.",
        flush=True,
    )
    while True:
        for child in children:
            if child.poll() is not None:
                raise RuntimeError("A lab process exited. Inspect data/*.log")
        time.sleep(2)
except KeyboardInterrupt:
    pass
finally:
    for child in reversed(children):
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
    for log in logs:
        log.close()
