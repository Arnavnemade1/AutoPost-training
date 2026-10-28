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
from pydantic import BaseModel, ConfigDict
from services.core import store
from services.core.contracts import CampaignConfig
from services.core.engine import actor, governance, probe, spawn
from services.core.actor_client import get_actor
from services.core.lifecycle import reconcile, TERMINAL

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


@app.middleware("http")
async def local_boundary(request: Request, call_next):
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin")
        if origin and origin not in {"http://localhost:3000", "http://127.0.0.1:3000"}:
            from fastapi.responses import JSONResponse

            return JSONResponse({"detail": "Untrusted request origin"}, status_code=403)
    return await call_next(request)


@app.get("/health")
def health():
    services = {}
    for name, url in [("terse", "http://127.0.0.1:7100"), ("relay", "http://127.0.0.1:7529/health")]:
        try:
            r = httpx.get(url, timeout=3)
            services[name] = {"connected": r.status_code < 500, "mode": "Local runtime"}
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
    return store.get(cid)


@app.get("/campaigns/{cid}")
def get_campaign(cid: str):
    s = store.get(cid)
    if not s:
        raise HTTPException(404, "Campaign not found")
    try:
        s["actor"] = json.loads(actor(cid).snapshot())
    except Exception:
        s["actor_unavailable"] = True
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
    from services.core.training import sha

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
