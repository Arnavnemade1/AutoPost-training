import json
import os
import uuid
import asyncio
from contextlib import suppress
from pathlib import Path
from contextlib import asynccontextmanager
from dotenv import load_dotenv
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from services.core import production, store
from services.core.contracts import CampaignConfig
from services.core.engine import actor, governance, probe, spawn
from services.core.actor_client import get_actor
from services.core.lifecycle import reconcile, TERMINAL
from services.chaos_routes import router as chaos_router

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


@asynccontextmanager
async def lifespan(_app):
    reconcile()

    async def monitor():
        while True:
            await asyncio.sleep(3)
            await asyncio.to_thread(reconcile)

    task = asyncio.create_task(monitor())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="Forge research control plane", lifespan=lifespan)
app.include_router(chaos_router)


API_PORT = httpx.URL(os.environ.get("FORGE_API_URL", "http://127.0.0.1:8000")).port or 8000
TRUSTED_HOSTS = {f"127.0.0.1:{API_PORT}", f"localhost:{API_PORT}"}
WEB_PORT = os.environ.get("FORGE_WEB_PORT", "3000")
TRUSTED_ORIGINS = {f"http://localhost:{WEB_PORT}", f"http://127.0.0.1:{WEB_PORT}"}


@app.middleware("http")
async def local_boundary(request: Request, call_next):
    # Every method checks Host: a DNS-rebound page reaches 127.0.0.1 under its
    # own hostname, so a same-origin check alone would let it read and mutate.
    from fastapi.responses import JSONResponse

    if request.headers.get("host") not in TRUSTED_HOSTS:
        return JSONResponse({"detail": "Untrusted host"}, status_code=403)
    origin = request.headers.get("origin")
    if origin and origin not in TRUSTED_ORIGINS:
        return JSONResponse({"detail": "Untrusted request origin"}, status_code=403)
    return await call_next(request)


@app.get("/health")
def health():
    services = {}
    terse = os.getenv("DURABLE_ACTORS_CONTROL_PLANE_URL", "http://127.0.0.1:7100")
    relay = os.getenv("FORGE_RELAY_BRIDGE", "http://127.0.0.1:7529")
    for name, url in [("terse", terse), ("relay", relay + "/health")]:
        try:
            r = httpx.get(url, timeout=3)
            services[name] = {"connected": r.status_code < 500, "mode": "Local runtime"}
            if name == "relay" and r.status_code == 200:
                bridge = r.json()
                services[name].update(
                    mode="Local runtime" if bridge.get("local", True) else "Hosted Relaycast",
                    transport=bridge.get("transport"),
                    endpoint=bridge.get("endpoint"),
                )
        except httpx.HTTPError:
            services[name] = {"connected": False, "mode": "Unavailable"}
    services["director"] = {
        "connected": bool(os.getenv("AZURE_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")),
        "mode": "Azure OpenAI" if os.getenv("AZURE_OPENAI_API_KEY") else "Local evidence director",
        "model": os.getenv("FORGE_DIRECTOR_MODEL", "local"),
    }
    services["storage"] = {
        "connected": bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY")),
        "mode": "Supabase private storage" if os.getenv("SUPABASE_SERVICE_ROLE_KEY") else "Local artifacts",
    }
    return {
        "ok": True,
        "services": services,
        "worker": "Apple M3 / Metal" if os.uname().machine == "arm64" else "PyTorch worker",
        "version": "0.1.0",
    }


@app.get("/campaigns")
def list_campaigns():
    return [
        {k: s.get(k) for k in ["id", "name", "status", "created_at", "config", "best", "final"]}
        for s in store.campaigns()
    ]


@app.post("/campaigns", status_code=201)
def create_campaign(config: CampaignConfig):
    # A single local GPU slot. Serialize check + persist + dispatch across API threads.
    with store.LOCK:
        return initialize_campaign(config)


def initialize_campaign(config: CampaignConfig):
    if any(s["status"] not in TERMINAL for s in store.campaigns()):
        raise HTTPException(409, "A campaign already owns the local GPU. Stop it or wait for completion.")
    if config.production_scan and not production.load_scan(config.production_scan):
        raise HTTPException(404, "Production scan not found")
    cid = "forge-" + uuid.uuid4().hex[:8]
    c = config.model_dump()
    state = json.loads(actor(cid).initialize(json.dumps(c)))
    governance(cid).initialize(
        json.dumps(
            {
                "reward_version": "exact-answer-v1",
                "max_regression_drop": 0.25,
                "objective": config.objective,
                "model": config.model_id,
                "sealed_test": True,
            }
        )
    )
    (store.ARTIFACTS / cid).mkdir(exist_ok=True)
    s = {
        "id": cid,
        "name": config.name,
        "config": c,
        "status": "initialized",
        "created_at": store.now(),
        "actor": state,
        "experiments": [],
        "reviews": [],
        "environments": [],
        "artifacts": [],
        "recording": {"status": "not_started"},
        "dispatch_pending": True,
        "controller_pid": os.getpid(),
    }
    store.save(s)
    store.event(cid, "created", "Campaign initialized. Immutable objective and budget saved in Terse.")
    spawn(cid)
    store.patch(cid, lambda s: s.update(dispatch_pending=False))
    return get_campaign(cid)


@app.get("/campaigns/{cid}")
def get_campaign(cid: str):
    s = store.get(cid)
    if not s:
        raise HTTPException(404, "Campaign not found")
    try:
        s["actor"] = json.loads(actor(cid).snapshot())
    except Exception:
        s["actor_unavailable"] = True
    from services.core.briefing import build

    s["briefing"] = build(s, store.events(cid))
    return s


@app.get("/campaigns/{cid}/events")
def events(cid: str, after: str | None = None):
    if not store.get(cid):
        raise HTTPException(404, "Campaign not found")
    return store.events(cid, after)


@app.post("/campaigns/{cid}/cancel")
def cancel(cid: str):
    s = store.get(cid)
    if not s:
        raise HTTPException(404, "Campaign not found")
    if s["status"] not in TERMINAL:
        store.patch(cid, lambda current: current.update(cancel_requested=True))
        store.event(
            cid, "cancel_requested", "Stop requested. Worker will release compute at the next safe boundary."
        )
    return {"ok": True}


@app.post("/campaigns/{cid}/probe")
def integrity_probe(cid: str):
    if not store.get(cid):
        raise HTTPException(404, "Campaign not found")
    return probe(cid)


@app.get("/campaigns/{cid}/environments/{eid}")
def environment(cid: str, eid: str):
    s = store.get(cid)
    if not s or not any(e["id"] == eid for e in s.get("environments", [])):
        raise HTTPException(404, "Environment not found")
    return json.loads(get_actor("RLWorldActor", eid).observe())


@app.get("/campaigns/{cid}/actors")
def actor_state(cid: str):
    s = store.get(cid)
    if not s:
        raise HTTPException(404, "Campaign not found")
    try:
        campaign = json.loads(actor(cid).snapshot())
        council = json.loads(governance(cid).snapshot())
        registry = json.loads(get_actor("ArtifactRegistryActor", cid).snapshot())
        latest = s.get("experiments", [])[-1:]
        experiment = (
            json.loads(get_actor("ExperimentActor", f"{cid}-{latest[0]['id']}").snapshot())
            if latest
            else None
        )
    except Exception as error:
        raise HTTPException(
            503, "Terse snapshots are temporarily unavailable. Retry to read durable state."
        ) from error
    return {
        "campaign_id": cid,
        "read_at": store.now(),
        "runtime": "Terse 0.14 / local native runtime",
        "campaign": campaign,
        "governance": council,
        "registry": registry,
        "experiment": experiment,
        "experiment_id": latest[0]["id"] if latest else None,
    }


@app.get("/campaigns/{cid}/artifacts/{aid}")
def download(cid: str, aid: str):
    s = store.get(cid)
    a = next((a for a in (s or {}).get("artifacts", []) if a["id"] == aid), None)
    if not a:
        raise HTTPException(404, "Artifact not found")
    root = (store.ARTIFACTS / cid).resolve()
    p = (root / a["path"]).resolve()
    if not p.is_relative_to(root) or not p.is_file():
        raise HTTPException(404, "Artifact unavailable")
    from forge_training.artifacts import file_sha256 as sha

    if sha(p) != a["sha256"]:
        raise HTTPException(409, "Artifact checksum mismatch; download blocked")
    return FileResponse(p, filename=p.name)


@app.get("/campaigns/{cid}/trace")
def trace(cid: str):
    if not store.get(cid):
        raise HTTPException(404, "Campaign not found")
    rows = store.events(cid)
    return StreamingResponse(
        iter([json.dumps(e) + "\n" for e in rows]),
        media_type="application/x-ndjson",
        headers={"Content-Disposition": f'attachment; filename="{cid}-trace.jsonl"'},
    )


class RecordingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str
    started_at: str | None = None
    artifact_path: str | None = None


@app.post("/campaigns/{cid}/recording")
def recording(cid: str, update: RecordingUpdate):
    s = store.get(cid)
    if not s:
        raise HTTPException(404, "Campaign not found")
    if update.status not in {"recording", "saved", "failed"}:
        raise HTTPException(422, "Invalid recording state")
    store.patch(cid, lambda current: current.update(recording=update.model_dump()))
    return {"ok": True}


class ProductionUpload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    traces: str = Field(min_length=1, max_length=8_000_000)
    labels: str | None = Field(default=None, max_length=2_000_000)


@app.get("/production/scans")
def production_scans():
    return production.scans()


@app.post("/production/scans", status_code=201)
def create_production_scan(upload: ProductionUpload):
    try:
        report = production.save_scan(upload.name, upload.traces, upload.labels)
    except (ValueError, KeyError, json.JSONDecodeError) as error:
        raise HTTPException(422, f"Could not scan production traces: {error}") from error
    return production.summary(report)


@app.get("/production/scans/{scan_id}")
def production_scan(scan_id: str):
    report = production.load_scan(scan_id)
    if not report:
        raise HTTPException(404, "Production scan not found")
    return report
