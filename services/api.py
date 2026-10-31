import json
import os
import uuid
import asyncio
from contextlib import suppress
from pathlib import Path
from typing import Literal
from contextlib import asynccontextmanager
from dotenv import load_dotenv
import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from services.core import agents, compute, distill, packs, production, store, strategies, uploads
from services.core.packs import register as pack_register
from services.core.hephaestus import desk as hephaestus_desk
from services.core.overseer import (
    connections as overseer_connect,
    review as overseer_review,
    traces as overseer_traces,
    vms as overseer_vms,
    worker as overseer_worker,
)
from services.core.contracts import DEFAULT_MODEL_ID, MODEL_ID, MODELS, CampaignConfig, model_spec
from services.core.engine import actor, bridge_headers, bridge_url, governance, probe, send, spawn
from services.core.actor_client import get_actor
from services.core.lifecycle import reconcile, TERMINAL
from services.chaos_routes import router as chaos_router

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


OVERSEER_SECONDS = float(os.environ.get("FORGE_OVERSEER_SECONDS", "60"))
MAX_DIRECTIVES = 5


@asynccontextmanager
async def lifespan(_app):
    reconcile()

    async def monitor():
        while True:
            await asyncio.sleep(3)
            await asyncio.to_thread(reconcile)

    async def oversee():
        # Production traces: pull from the Supabase buffer, check, judge within budget, alert.
        while True:
            await asyncio.sleep(OVERSEER_SECONDS)
            with suppress(Exception):
                await asyncio.to_thread(overseer_worker.cycle)

    async def report():
        # Campaigns started from the private Hephaestus conversation: report the end, guard memory.
        while True:
            await asyncio.sleep(30)
            with suppress(Exception):
                await asyncio.to_thread(hephaestus_desk.watch)

    tasks = [asyncio.create_task(monitor()), asyncio.create_task(report())]
    if OVERSEER_SECONDS > 0:
        tasks.append(asyncio.create_task(oversee()))
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


app = FastAPI(title="Forge research control plane", lifespan=lifespan)
app.include_router(chaos_router)


API_PORT = httpx.URL(os.environ.get("FORGE_API_URL", "http://127.0.0.1:8000")).port or 8000
TRUSTED_HOSTS = {f"127.0.0.1:{API_PORT}", f"localhost:{API_PORT}"}
WEB_PORT = os.environ.get("FORGE_WEB_PORT", "3000")
TRUSTED_ORIGINS = {f"http://localhost:{WEB_PORT}", f"http://127.0.0.1:{WEB_PORT}"}
TERSE_URL = os.environ.get("DURABLE_ACTORS_CONTROL_PLANE_URL", "http://127.0.0.1:7100")
RELAY_BRIDGE_URL = bridge_url()


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
    for name, url in [("terse", TERSE_URL), ("relay", RELAY_BRIDGE_URL + "/health")]:
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
        except (httpx.HTTPError, ValueError):
            services[name] = {"connected": False, "mode": "Unavailable"}
    team = agents.status()
    services["director"] = {
        "connected": team["connected"],
        "mode": team["provider"] or "Local evidence director",
        "model": team["models"].get("director", "local"),
        # Every role reasons with a model when keys are set, and may spin up subagents.
        "agents": team["models"],
        "subagents": team["subagents"],
    }
    services["storage"] = {
        "connected": bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY")),
        "mode": "Supabase private storage" if os.getenv("SUPABASE_SERVICE_ROLE_KEY") else "Local artifacts",
    }
    try:
        backend = compute.describe()
    except ValueError as error:
        backend = {"backend": "invalid", "label": None, "gpu": None, "error": str(error)}
    local = "Apple M3 / Metal" if os.uname().machine == "arm64" else "PyTorch worker"
    return {
        "ok": True,
        "services": services,
        "worker": backend["label"] or local,
        "compute": backend,
        "model": {k: model_spec(DEFAULT_MODEL_ID)[k] for k in ("id", "label", "parameters")},
        "version": "0.1.0",
    }


@app.get("/campaigns")
def list_campaigns():
    return [
        {k: s.get(k) for k in ["id", "name", "status", "created_at", "config", "best", "final"]}
        for s in store.campaigns()
    ]


@app.get("/models")
def list_models():
    return [
        {
            "id": model_id,
            "label": spec["label"],
            "parameters": spec["parameters"],
            "remote_only": spec["remote_only"],
        }
        for model_id, spec in MODELS.items()
    ]


@app.get("/strategies")
def list_strategies():
    return strategies.listing()


@app.get("/packs")
def list_packs():
    return [packs.summary(pack) for pack in packs.available()]


@app.get("/packs/{pack_id}")
def get_pack(pack_id: str):
    try:
        pack = packs.get(pack_id)
    except KeyError as error:
        raise HTTPException(404, "Task pack not found") from error
    detail = packs.summary(pack) | {
        "task": pack.task.model_dump(mode="json"),
        "limitations": pack.limitations,
    }
    if not detail["builtin"]:
        report = json.loads((packs.folder(pack_id) / "report.json").read_text())
        # Training samples only. Development and sealed rows are never previewed.
        detail |= {
            "samples": report["samples"],
            "invalid": report["invalid"],
            "duplicates": report["duplicates"],
        }
    return detail


class UploadStart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    size: int = Field(ge=1)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class UploadPart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    index: int = Field(ge=0, le=99_999)
    text: str = Field(max_length=uploads.MAX_PART)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class UploadDone(BaseModel):
    model_config = ConfigDict(extra="forbid")
    parts: int = Field(ge=1, le=100_000)


@app.post("/uploads", status_code=201)
def start_upload(upload: UploadStart):
    try:
        return uploads.start(upload.name, upload.size, upload.sha256)
    except ValueError as error:
        raise HTTPException(413, str(error)) from error


@app.post("/uploads/{upload_id}/parts")
def upload_part(upload_id: str, part: UploadPart):
    try:
        return uploads.part(upload_id, part.index, part.text, part.sha256)
    except KeyError as error:
        raise HTTPException(404, "Upload not found") from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@app.post("/uploads/{upload_id}/complete")
def complete_upload(upload_id: str, done: UploadDone):
    try:
        return uploads.complete(upload_id, done.parts)
    except (KeyError, FileNotFoundError) as error:
        raise HTTPException(404, "Upload not found") from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


class PackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    draft: pack_register.Draft
    upload_id: str | None = None
    text: str | None = Field(default=None, max_length=uploads.MAX_PART)


def _draft(request: PackRequest):
    if (request.upload_id is None) == (request.text is None):
        raise HTTPException(422, "Send either an upload id or inline text")
    try:
        text = request.text if request.text is not None else uploads.text(request.upload_id)
        return pack_register.build(request.draft, text)
    except KeyError as error:
        raise HTTPException(404, "Upload not found") from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@app.post("/packs/preview")
def preview_pack(request: PackRequest):
    pack, _, report = _draft(request)
    return {k: v for k, v in report.items() if k != "salt"} | {"checker": pack.task.make_checker().checker_id}


@app.post("/packs", status_code=201)
def register_pack(request: PackRequest):
    pack, pools, report = _draft(request)
    if report["problems"]:
        raise HTTPException(422, "; ".join(report["problems"]))
    return packs.summary(packs.save(pack, pools, report))


class TeacherRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    teacher: dict


class TeacherJob(BaseModel):
    model_config = ConfigDict(extra="forbid")
    teacher: dict
    sampling: dict | None = None
    budget: dict | None = None
    selection: str = Field(default="shortest_correct", pattern=r"^(shortest_correct|first_correct)$")
    seed: int = Field(default=42, ge=0, le=2147483647)
    dev_samples: int = Field(default=12, ge=4, le=100)


@app.post("/distill/probe")
def probe_teacher(request: TeacherRequest):
    # The local proxy gives up after 30 seconds; a probe must answer well within it.
    teacher = request.teacher | {
        "timeout_s": min(float(request.teacher.get("timeout_s", 20)), 20),
        "max_retries": 0,
    }
    try:
        return distill.probe(teacher)
    except ValidationError as error:
        raise HTTPException(422, str(error)) from error
    except (RuntimeError, ValueError) as error:
        raise HTTPException(502, str(error)) from error


@app.post("/packs/{pack_id}/teacher-data", status_code=201)
def start_teacher_data(pack_id: str, job: TeacherJob):
    try:
        return distill.start(
            pack_id, job.teacher, job.sampling, job.budget, job.selection, job.seed, job.dev_samples
        )
    except KeyError as error:
        raise HTTPException(404, "Task pack not found") from error
    except ValidationError as error:
        raise HTTPException(422, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except RuntimeError as error:
        raise HTTPException(409, str(error)) from error


@app.get("/packs/{pack_id}/teacher-data")
def teacher_data_jobs(pack_id: str):
    try:
        packs.get(pack_id)
    except KeyError as error:
        raise HTTPException(404, "Task pack not found") from error
    return distill.jobs(pack_id)


@app.get("/packs/{pack_id}/teacher-data/{syn_id}")
def teacher_data_job(pack_id: str, syn_id: str):
    job = distill.status(pack_id, syn_id) if packs.PACK_ID.match(pack_id) else None
    if not job:
        raise HTTPException(404, "Teacher dataset not found")
    return job


@app.post("/campaigns", status_code=201)
def create_campaign(config: CampaignConfig):
    # A single local GPU slot. Serialize check + persist + dispatch across API threads.
    with store.LOCK:
        return initialize_campaign(config)


def initialize_campaign(config: CampaignConfig):
    if any(s["status"] not in TERMINAL for s in store.campaigns()):
        raise HTTPException(409, "A campaign already owns the local GPU. Stop it or wait for completion.")
    if any(job["local"] for job in distill.running()):
        raise HTTPException(409, "A local teacher is writing a dataset. Wait for it to finish.")
    try:
        backend = compute.configured()
    except ValueError as error:
        raise HTTPException(503, str(error)) from error
    try:
        pack = packs.get(config.task_pack)
    except KeyError as error:
        raise HTTPException(404, "Task pack not found") from error
    if backend != "local" and "grpo" in config.strategies:
        raise HTTPException(422, "GRPO runs only on the local backend. Choose SFT strategies for Modal.")
    found = strategies.problems(config.model_dump(), pack, backend)
    if found:
        raise HTTPException(422, " ".join(found))
    if backend != "local" and not pack.capabilities.remote:
        raise HTTPException(422, f"{pack.display.name} is evaluated on the local backend only.")
    if config.final_backend == "lm_eval_azure" and not pack.capabilities.lm_eval_final:
        raise HTTPException(422, f"The independent harness final is not available for {pack.display.name}.")
    if config.synthetic_dataset and not distill.find(pack.id, config.synthetic_dataset):
        raise HTTPException(404, "Teacher dataset not found for this task pack")
    spec = model_spec(config.model_id)
    if spec["remote_only"] and backend == "local":
        raise HTTPException(
            422, f"{config.model_id} needs a cloud GPU. Start the lab with FORGE_BACKEND=modal."
        )
    if config.model_id != MODEL_ID and (
        "grpo" in config.strategies or config.final_backend != "shared_scorer"
    ):
        raise HTTPException(
            422, f"{config.model_id} supports SFT strategies and the shared final scorer only."
        )
    if config.production_scan:
        scan = production.load_scan(config.production_scan)
        if not scan:
            raise HTTPException(404, "Production scan not found")
        if scan.get("task_pack", packs.DEFAULT) != pack.id:
            raise HTTPException(422, "That production scan belongs to a different task")
    cid = "forge-" + uuid.uuid4().hex[:8]
    c = config.model_dump()
    state = json.loads(actor(cid).initialize(json.dumps(c)))
    governance(cid).initialize(
        json.dumps(
            {
                "reward_version": pack.reward_version,
                "task_pack": pack.id,
                "task_pack_sha256": pack.sha256,
                "policy_version": "forge-policy-v2",
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


@app.get("/campaigns/{cid}/relay/search")
def relay_search(cid: str, q: str = Query(min_length=1, max_length=200)):
    """Agent Relay's own full-text search over the campaign's research room."""
    if not store.get(cid):
        raise HTTPException(404, "Campaign not found")
    try:
        r = httpx.get(
            bridge_url() + "/search",
            params={"campaign_id": cid, "q": q},
            headers=bridge_headers(),
            timeout=10,
        )
        r.raise_for_status()
        rows = r.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(503, "Agent Relay search is unavailable") from None
    return [row for row in rows if isinstance(row, dict) and isinstance(row.get("message_id"), str)]


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


class Directive(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=3, max_length=500)


@app.post("/campaigns/{cid}/directives", status_code=201)
def direct_campaign(cid: str, directive: Directive):
    """Hephaestus posts in the research room, and the director reads it before its next experiment."""
    s = store.get(cid)
    if not s:
        raise HTTPException(404, "Campaign not found")
    if s["status"] in TERMINAL:
        raise HTTPException(409, "That campaign has ended, so there is no team to direct.")
    if len(s.get("directives") or []) >= MAX_DIRECTIVES:
        raise HTTPException(409, f"That campaign already has {MAX_DIRECTIVES} instructions.")
    try:
        receipt = send(cid, "hephaestus", "director", "OPERATOR_DIRECTIVE", directive.text, route="room")
    except RuntimeError as error:
        raise HTTPException(503, "Agent Relay is unavailable, so nothing was posted.") from error
    store.patch(cid, lambda current: current.setdefault("directives", []).append(directive.text))
    return {"posted": True, "relay_id": receipt["message_id"], "read_by_model": agents.configured()}


class HephaestusMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=2000)


@app.get("/hephaestus/messages")
def hephaestus_messages():
    return hephaestus_desk.history()


@app.post("/hephaestus/messages", status_code=202)
def hephaestus_message(message: HephaestusMessage, background: BackgroundTasks):
    """The reply can take a while, so it runs after this returns and the page picks it up."""
    posted = hephaestus_desk.post(message.text)
    background.add_task(hephaestus_desk.respond, message.text)
    return posted


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


class OverseerTraces(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
    task_pack: str = "gsm8k"
    traces: list[dict] = Field(min_length=1, max_length=overseer_traces.MAX_BATCH)


class OverseerLabel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(min_length=3, max_length=300)
    answer: str = Field(min_length=1, max_length=32000)
    reviewer: str = Field(default="reviewer", min_length=1, max_length=80)


class OverseerExport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    task_pack: str
    name: str = Field(min_length=1, max_length=80)


class OverseerConnection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    task_pack: str
    kind: Literal["http", "langfuse"]
    provider: Literal["superserve", "local"] | None = None
    url: str | None = Field(default=None, max_length=2000)
    auth_type: Literal["none", "bearer", "api-key", "basic"] = "none"
    username: str | None = Field(default=None, max_length=300)
    header: str | None = Field(default=None, pattern=r"^[A-Za-z0-9-]{1,64}$")
    prefix: str | None = Field(default=None, max_length=32)
    secret: str | None = Field(default=None, max_length=8000)
    records_path: str | None = Field(default=None, max_length=200)
    cursor_param: str | None = Field(default=None, max_length=64)
    cursor_field: str | None = Field(default=None, max_length=200)
    start_cursor: str | None = Field(default=None, max_length=200)
    page_cursor_param: str | None = Field(default=None, max_length=64)
    page_cursor_path: str | None = Field(default=None, max_length=200)
    mapping: dict[str, str] | None = None
    poll_seconds: int | None = Field(default=None, ge=15, le=3600)
    daily_cap: int | None = Field(default=None, gt=0, le=1_000_000)
    data_terms: str = Field(min_length=20, max_length=2000)


class OverseerMapping(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mapping: dict[str, str] = Field(min_length=1, max_length=20)


@app.get("/overseer/connections")
def overseer_connections(task_pack: str | None = None):
    return overseer_connect.listing(task_pack)


@app.post("/overseer/connections", status_code=201)
def overseer_connect_source(request: OverseerConnection, background: BackgroundTasks):
    """Link a traffic source once. The VM boots in the background, and the agent takes it from there."""
    fields = request.model_dump()
    secret = fields.pop("secret")
    try:
        connection = overseer_connect.create({**fields, "secret": secret})
    except KeyError as error:
        raise HTTPException(404, "Task pack not found") from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    background.add_task(overseer_connect.start, connection["id"], secret)
    return connection


@app.post("/overseer/connections/{connection_id}/mapping")
def overseer_connection_mapping(connection_id: str, request: OverseerMapping):
    try:
        return overseer_connect.set_mapping(connection_id, request.mapping)
    except KeyError as error:
        raise HTTPException(404, "Connection not found") from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@app.post("/overseer/connections/{connection_id}/restart")
def overseer_connection_restart(connection_id: str):
    try:
        return overseer_connect.restart(connection_id)
    except KeyError as error:
        raise HTTPException(404, "Connection not found") from error
    except ValueError as error:
        raise HTTPException(409, str(error)) from error


@app.post("/overseer/connections/{connection_id}/disconnect")
def overseer_connection_disconnect(connection_id: str):
    try:
        return overseer_connect.disconnect(connection_id)
    except KeyError as error:
        raise HTTPException(404, "Connection not found") from error
    except overseer_vms.VMError as error:
        raise HTTPException(502, str(error)) from error


@app.get("/overseer/summary")
def overseer_summary(task_pack: str | None = None):
    return overseer_worker.summary(task_pack)


@app.post("/overseer/traces", status_code=202)
def overseer_ingest(batch: OverseerTraces):
    """Local intake for apps on this machine and demos. Remote deployments use the Supabase buffer."""
    try:
        return overseer_traces.ingest(batch.traces, batch.source, batch.task_pack)
    except KeyError as error:
        raise HTTPException(404, "Task pack not found") from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@app.post("/overseer/cycle")
def overseer_cycle():
    return overseer_worker.cycle()


@app.get("/overseer/queue")
def overseer_queue(task_pack: str = "gsm8k", limit: int = 50):
    return overseer_review.queue(task_pack, max(1, min(limit, 200)))


@app.post("/overseer/labels")
def overseer_label(label: OverseerLabel):
    try:
        return overseer_review.label(label.key, label.answer, label.reviewer)
    except KeyError as error:
        raise HTTPException(404, "Trace not found") from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@app.post("/overseer/export", status_code=201)
def overseer_export(request: OverseerExport):
    try:
        return overseer_review.export(request.task_pack, request.name)
    except KeyError as error:
        raise HTTPException(404, "Task pack not found") from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
