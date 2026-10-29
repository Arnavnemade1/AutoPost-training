"""Start the complete local lab, reusing healthy services and owning only new processes."""

import os
import secrets
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
# Unset or loopback: this command runs a local Relaycast engine. Otherwise the bridge uses
# that engine, e.g. the hosted https://cast.agentrelay.com.
RELAY_URL = (
    settings.get("FORGE_RELAY_URL")
    or os.environ.get("FORGE_RELAY_URL")
    # A workspace key with no URL means the hosted engine (services/relay/config.mjs).
    or (
        "https://cast.agentrelay.com"
        if settings.get("FORGE_RELAY_WORKSPACE_KEY") or os.environ.get("FORGE_RELAY_WORKSPACE_KEY")
        else "http://127.0.0.1:7528"
    )
)
LOCAL_RELAY = httpx.URL(RELAY_URL).host in ("127.0.0.1", "localhost")


def healthy(url):
    try:
        return httpx.get(url, timeout=1).status_code < 500
    except httpx.HTTPError:
        return False


def start(name, cmd, url, env=None):
    if healthy(url):
        print(f"{name}: using existing service", flush=True)
        return
    log = (ROOT / "data" / f"{name}.log").open("a")
    logs.append(log)
    child = subprocess.Popen(
        cmd, cwd=ROOT, stdout=log, stderr=log, start_new_session=True, env={**os.environ, **(env or {})}
    )
    children.append(child)
    for _ in range(90):
        if child.poll() is not None:
            raise RuntimeError(f"{name} failed. Read data/{name}.log")
        if healthy(url):
            print(f"{name}: ready", flush=True)
            return
        time.sleep(1)
    raise TimeoutError(f"{name} did not become ready")


def stop(_signal, _frame):
    raise KeyboardInterrupt


signal.signal(signal.SIGTERM, stop)


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
    # Agent Relay. RELAY_URL picks the engine; FORGE_RELAY_WORKSPACE_KEY (env or .env) picks a
    # workspace on it and reaches only the bridge. See docs/agent-relay.md.
    relay_env = {k: v for k, v in settings.items() if k.startswith("FORGE_RELAY_") and v}
    relay_env["FORGE_RELAY_URL"] = RELAY_URL
    # Per-launch bridge secret: only the bridge and the API (and the campaign workers it
    # spawns) hold it. A bridge reused from an earlier launch keeps that launch's secret.
    token_file = ROOT / "data" / "relay-bridge.token"
    if not (healthy("http://127.0.0.1:7529/health") and token_file.exists()):
        token_file.unlink(missing_ok=True)
        fd = os.open(token_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(secrets.token_urlsafe(32))
    bridge_token = token_file.read_text().strip()
    relay_env["FORGE_RELAY_BRIDGE_TOKEN"] = bridge_token
    if LOCAL_RELAY:
        start(
            "relaycast",
            [
                "node",
                "services/relay/server.mjs",
                "data/relaycast.db",
                "7528",
            ],
            "http://127.0.0.1:7528",
        )
    start(
        "relay-bridge",
        ["node", "services/relay/bridge.mjs"],
        "http://127.0.0.1:7529/health",
        relay_env,
    )
    start(
        "api",
        [sys.executable, "-m", "uvicorn", "services.api:app", "--host", "127.0.0.1", "--port", "8000"],
        "http://127.0.0.1:8000/health",
        env=os.environ | {"FORGE_RELAY_BRIDGE_TOKEN": bridge_token},
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
