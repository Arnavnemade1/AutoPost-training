import json
import os
import sys
import uuid
from pathlib import Path
import httpx
from services.core import store
from services.core.contracts import Message
from services.actors.generated import actors


def actor(campaign_id):
    return actors.ResearchCampaignActor.get(campaign_id)


def governance(campaign_id):
    return actors.GovernanceActor.get(campaign_id)


def send(campaign_id, sender, recipient, category, text, experiment_id=None):
    message = Message(id=uuid.uuid4().hex, campaign_id=campaign_id, sender=sender, recipient=recipient,
                      category=category, text=text, experiment_id=experiment_id)
    # Persist assignment before notification. Retries retain the same idempotency key.
    store.event(campaign_id, "message_pending", text, sender, message=message.model_dump())
    last_error = None
    for _ in range(3):
        try:
            r = httpx.post(os.getenv("FORGE_RELAY_BRIDGE", "http://127.0.0.1:7529") + "/message", json=message.model_dump(), timeout=20)
            r.raise_for_status()
            receipt = r.json()
            if not receipt.get("delivered") or not receipt.get("message_id"):
                raise ValueError("Relay delivery unconfirmed")
            store.event(campaign_id, "message", text, sender, recipient=recipient, category=category,
                        experiment_id=experiment_id, relay_id=receipt["message_id"], receipt=receipt)
            return receipt
        except (httpx.HTTPError, ValueError) as e:
            last_error = type(e).__name__
    raise RuntimeError(f"Agent Relay delivery failed ({last_error}); execution paused before downstream work")


def transition(campaign_id, status, reason):
    state = json.loads(actor(campaign_id).transition(status, reason))
    snapshot = store.get(campaign_id)
    snapshot["status"] = status
    snapshot["actor"] = state
    store.save(snapshot)
    store.event(campaign_id, "stage", reason, status=status)


def cancelled(campaign_id):
    s = store.get(campaign_id)
    return bool(s.get("cancel_requested"))


def artifact(campaign_id, path, kind, title):
    from services.core.training import sha
    p = Path(path)
    a = {"id": uuid.uuid4().hex, "campaign_id": campaign_id, "name": title, "kind": kind,
         "path": str(p.relative_to(store.ARTIFACTS / campaign_id)), "sha256": sha(p), "bytes": p.stat().st_size, "created_at": store.now()}
    actors.ArtifactRegistryActor.get(campaign_id).register(json.dumps(a))
    s = store.get(campaign_id)
    s["artifacts"] = [*s.get("artifacts", []), a]
    store.save(s)
    store.event(campaign_id, "artifact", f"Saved {title}", "trainer", artifact=a)
    return a


def checkpoint_zip(folder):
    import zipfile
    target = folder.parent / f"{folder.name}.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for p in folder.rglob("*"):
            if p.is_file():
                z.write(p, p.relative_to(folder))
    return target


def add_review(campaign_id, evidence):
    review = json.loads(governance(campaign_id).review(json.dumps(evidence)))
    review["timestamp"] = store.now()
    s = store.get(campaign_id)
    s["reviews"] = [*s.get("reviews", []), review]
    store.save(s)
    store.event(campaign_id, "review", "; ".join(review["reason_codes"]) or "Independent checks passed", "governance", review=review)
    return review


def probe(campaign_id):
    # A disclosed adversarial fixture. It never modifies a real experiment.
    evidence = {"id": "probe-" + uuid.uuid4().hex[:8], "phase": "preflight", "reward_version": "always-reward-one",
                "sealed_data_access": True, "provenance_valid": True, "controlled_probe": True}
    review = add_review(campaign_id, evidence)
    try:
        governance(campaign_id).promote(evidence["id"], "0" * 64)
    except Exception:
        store.event(campaign_id, "blocked", "Controlled probe: modified reward and sealed data access rejected. Promotion attempt blocked.", "governance")
        return review
    raise RuntimeError("Governance enforcement failed")


def spawn(campaign_id):
    import subprocess
    log = (store.ARTIFACTS / campaign_id / "worker.log").open("a")
    process = subprocess.Popen([sys.executable, "-m", "services.core.runner", campaign_id], cwd=store.ROOT,
                               stdout=log, stderr=log, start_new_session=True)
    s = store.get(campaign_id)
    s["worker_pid"] = process.pid
    store.save(s)
    log.close()
    return process.pid
