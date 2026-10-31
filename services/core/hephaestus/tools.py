"""What Hephaestus can do, and who may ask for it. Authority is enforced here, not by the model.

A group chat is untrusted input and the model can be talked into anything, so a tool an asker's role
doesn't allow is neither offered to the model nor run if it is called. Reports hold numbers and names
only: answers, questions and production text never leave the lab through this file.

Admin means running the agent chat: reading it, posting in it, directing the team and stopping any run.
It doesn't reach what makes a result trustworthy. No tool promotes a checkpoint, overrides governance,
raises a budget or touches sealed test data.
"""

import fcntl
import json
import os
import re
import subprocess
from datetime import UTC, datetime

import httpx

from services.core import store

TERMINAL = {"completed", "cancelled", "failed", "interrupted"}
STRATEGIES = {"broad_sft", "targeted_sft", "dpo"}
RANK = {"viewer": 0, "operator": 1, "admin": 2}


class ToolError(Exception):
    """A refusal or failure worth repeating in the chat."""


def _limit(name, default):
    return int(os.environ.get(f"FORGE_HEPHAESTUS_{name}") or default)


def own_connection():
    """Hephaestus's own model, if it has one. Set apart from the research agents' connection, whose
    evidence includes training examples, so a friend's account can serve it without seeing those."""
    values = [os.environ.get(f"FORGE_HEPHAESTUS_AZURE_{name}") for name in ("ENDPOINT", "KEY", "MODEL")]
    return values if all(values) else None


def _shared(update):
    """Change the counters every surface shares, under a lock, since iMessage is another process."""
    path = store.DATA / "hephaestus-limits.json"
    with open(store.DATA / "hephaestus-limits.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            values = json.loads(path.read_text())
        except (OSError, ValueError):
            values = {}
        result = update(values)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(values))
        temporary.replace(path)
    return result


def take(name, limit):
    """Count one use of something limited per day. False once the limit is reached."""
    day = datetime.now(UTC).strftime("%Y-%m-%d")

    def update(values):
        used = values.get(name, {}).get(day, 0)
        if used >= limit:
            return False
        values[name] = {day: used + 1}
        return True

    return _shared(update)


def free_memory_percent():
    """Free memory on this Mac, or None where that can't be read."""
    try:
        done = subprocess.run(["memory_pressure", "-Q"], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    found = re.search(r"free percentage:\s*(\d+)%", done.stdout)
    return int(found.group(1)) if found else None


def runs_here():
    return os.environ.get("FORGE_BACKEND", "local") == "local"


class Lab:
    """The lab's own API, on this machine, so every gate the command center has applies here too."""

    def __init__(self, client=None):
        self.client = client or httpx.Client(
            base_url=os.environ.get("FORGE_API_URL", "http://127.0.0.1:8000"), timeout=30
        )

    def call(self, method, path, **options):
        try:
            reply = self.client.request(method, path, **options)
        except httpx.HTTPError as error:
            raise ToolError("The lab isn't running on this Mac right now.") from error
        if reply.status_code >= 400:
            detail = reply.json().get("detail") if "json" in reply.headers.get("content-type", "") else None
            raise ToolError(detail if isinstance(detail, str) else f"The lab answered {reply.status_code}.")
        return reply.json()


def lab_status(context):
    health = context.lab.call("GET", "/health")
    active = [c["id"] for c in context.lab.call("GET", "/campaigns") if c["status"] not in TERMINAL]
    director = health.get("director") or health.get("services", {}).get("director", {})
    return {
        "active_campaigns": active,
        "research_agents": director.get("mode") or ("connected" if director.get("connected") else "local"),
        "free_memory_percent": free_memory_percent() if runs_here() else None,
    }


def list_tasks(context):
    return [
        {"id": p["id"], "name": p["display"]["name"], "kind": p["kind"]}
        for p in context.lab.call("GET", "/packs")
    ]


def _brief(campaign):
    final = campaign.get("final") or {}
    return {
        "id": campaign["id"],
        "name": campaign.get("name"),
        "status": campaign.get("status"),
        "task": (campaign.get("config") or {}).get("task_pack"),
        "improvement_claim": final.get("improvement_claim"),
        "improvement_points": _round(final.get("improvement_pp")),
    }


def _round(value):
    return round(value, 2) if isinstance(value, int | float) else None


def list_campaigns(context):
    campaigns = context.lab.call("GET", "/campaigns")
    return [_brief(c) for c in sorted(campaigns, key=lambda c: c.get("created_at") or "")[-5:]]


def campaign_report(context, campaign_id):
    _check_id(campaign_id)
    campaign = context.lab.call("GET", f"/campaigns/{campaign_id}")
    final = campaign.get("final") or {}
    report = _brief(campaign)
    report["experiments"] = [
        {
            "strategy": e.get("strategy"),
            "status": e.get("status"),
            "development_score": _round((e.get("evaluation") or {}).get("score")),
        }
        for e in campaign.get("experiments") or []
    ]
    if final:
        report["final"] = {
            "baseline": _round((final.get("baseline") or {}).get("score")),
            "checkpoint": _round((final.get("checkpoint") or {}).get("score")),
            "interval_95_points": final.get("paired_bootstrap_95_pp"),
            "valid_improvement": final.get("valid_improvement"),
            "kept_original_model": final.get("checkpoint_id") in (None, "baseline"),
        }
    return report


def is_campaign_id(value):
    return bool(re.fullmatch(r"forge-[0-9a-f]{8}", str(value)))


def _check_id(campaign_id):
    if not is_campaign_id(campaign_id):
        raise ToolError("That isn't a campaign id.")


def start_training(context, task_pack, objective=None, strategies=None, experiments=None, train_steps=None):
    """Start the research agents on a task, inside limits no message can raise."""
    if runs_here():
        free = free_memory_percent()
        if free is not None and free < _limit("MIN_FREE_MEMORY", 35):
            raise ToolError(f"This Mac has only {free}% of its memory free, so I won't start training.")
    config = {
        "name": f"Hephaestus · {task_pack}"[:80],
        "task_pack": task_pack,
        "max_seconds": _limit("MAX_SECONDS", 1800),
        "max_experiments": max(1, min(int(experiments or 2), _limit("MAX_EXPERIMENTS", 2))),
        "train_steps": max(4, min(int(train_steps or 24), _limit("MAX_TRAIN_STEPS", 48))),
    }
    if objective and len(objective.strip()) >= 10:
        config["objective"] = objective.strip()[:500]
    if strategies:
        unknown = set(strategies) - STRATEGIES
        if unknown:
            raise ToolError(f"I can only run {', '.join(sorted(STRATEGIES))} from the chat.")
        config["strategies"] = list(strategies)
    if not take("campaigns", _limit("DAILY_CAMPAIGNS", 3)):
        raise ToolError("I've reached today's limit of campaigns (FORGE_HEPHAESTUS_DAILY_CAMPAIGNS).")
    campaign = context.lab.call("POST", "/campaigns", json=config)
    _shared(lambda values: values.setdefault("started", []).append(campaign["id"]))
    context.state.setdefault("watching", {})[campaign["id"]] = campaign.get("status", "initialized")
    return {
        "started": campaign["id"],
        "limits": {k: config[k] for k in ("max_seconds", "max_experiments", "train_steps")},
    }


def stop_training(context, role, campaign_id):
    _check_id(campaign_id)
    started = _shared(lambda values: list(values.get("started", [])))
    if RANK[role] < RANK["admin"] and campaign_id not in started:
        raise ToolError("Only an admin can stop a campaign I didn't start.")
    context.lab.call("POST", f"/campaigns/{campaign_id}/cancel")
    return {"stopping": campaign_id}


def direct_team(context, campaign_id, instruction):
    """Post in the research room, as a verified participant. The director reads it before its next
    experiment. It can steer the research, but gates still decide what counts."""
    _check_id(campaign_id)
    return context.lab.call(
        "POST", f"/campaigns/{campaign_id}/directives", json={"text": str(instruction).strip()[:500]}
    )


def read_agent_chat(context, campaign_id, limit=20):
    """Who said what to whom. The words themselves can quote training examples, so they stay in the lab
    unless this is the lab's own screen and the model is the one the research agents already use."""
    _check_id(campaign_id)
    events = context.lab.call("GET", f"/campaigns/{campaign_id}/events")
    with_text = getattr(context, "surface", None) == "agent-chat" and not own_connection()
    delivered = [e for e in events if e.get("kind") == "message" and e.get("relay_id")]
    return [
        {
            "from": e.get("agent"),
            "to": e.get("recipient"),
            "category": e.get("category"),
            "where": e.get("route"),
            "experiment": e.get("experiment_id"),
            **({"text": str(e.get("text"))[:400]} if with_text else {}),
        }
        for e in delivered[-max(1, min(int(limit), 40)) :]
    ]


def request_azure_link(context, recipient=None):
    return {"post_this_exactly": azure_request(recipient)}


def azure_request(recipient=None):
    """Ask for what's needed to connect a friend's Azure model. Never asks for a key in the chat."""
    who = f"{recipient}, could" if recipient else "Could"
    return (
        f"{who} you connect your Azure model to me?\n\n"
        "I need your Azure OpenAI v1 endpoint URL and your deployment name, plus a key limited to that "
        "deployment, with a spending limit you're happy with.\n\n"
        "Please don't paste the key here. Send it privately to whoever runs this lab.\n\n"
        "Your model would see messages addressed to me and training status: campaign names, scores and "
        "strategies. It wouldn't see customer traffic or test answers."
    )


NO_ARGS = {"type": "object", "properties": {}, "additionalProperties": False}
ID_ARG = {
    "type": "object",
    "properties": {"campaign_id": {"type": "string"}},
    "required": ["campaign_id"],
    "additionalProperties": False,
}
TOOLS = {
    "lab_status": (
        lab_status,
        "viewer",
        "Whether a campaign is running, and the Mac's free memory.",
        NO_ARGS,
    ),
    "list_tasks": (list_tasks, "viewer", "The tasks that can be trained.", NO_ARGS),
    "list_campaigns": (list_campaigns, "viewer", "The most recent campaigns and their results.", NO_ARGS),
    "campaign_report": (campaign_report, "viewer", "Measured results of one campaign.", ID_ARG),
    "start_training": (
        start_training,
        "operator",
        "Start the research agents on a task. They choose and run experiments; gates decide the outcome.",
        {
            "type": "object",
            "properties": {
                "task_pack": {"type": "string", "description": "A task id from list_tasks"},
                "objective": {"type": "string", "description": "What to improve, in a sentence"},
                "strategies": {"type": "array", "items": {"type": "string", "enum": sorted(STRATEGIES)}},
                "experiments": {"type": "integer"},
                "train_steps": {"type": "integer"},
            },
            "required": ["task_pack"],
            "additionalProperties": False,
        },
    ),
    "stop_training": (stop_training, "operator", "Stop a running campaign.", ID_ARG),
    "request_azure_link": (
        request_azure_link,
        "operator",
        "Get the request asking a friend to connect their Azure model.",
        {
            "type": "object",
            "properties": {"recipient": {"type": "string"}},
            "additionalProperties": False,
        },
    ),
    "direct_team": (
        direct_team,
        "admin",
        "Post an instruction in a running campaign's research room. The research director reads it "
        "before its next experiment. It can't change gates, budgets or the objective.",
        {
            "type": "object",
            "properties": {"campaign_id": {"type": "string"}, "instruction": {"type": "string"}},
            "required": ["campaign_id", "instruction"],
            "additionalProperties": False,
        },
    ),
    "read_agent_chat": (
        read_agent_chat,
        "admin",
        "See the latest messages between the research agents in a campaign.",
        {
            "type": "object",
            "properties": {"campaign_id": {"type": "string"}, "limit": {"type": "integer"}},
            "required": ["campaign_id"],
            "additionalProperties": False,
        },
    ),
}
ROLE_AWARE = {"stop_training"}


def allowed(role):
    return [name for name, tool in TOOLS.items() if RANK[role] >= RANK[tool[1]]]


def run(context, role, name, arguments):
    """Run a tool for someone in this role. The one place authority is decided."""
    if name not in TOOLS:
        raise ToolError(f"I have no tool called {name}.")
    if name not in allowed(role):
        raise ToolError(f"Only an {TOOLS[name][1]} can do that.")
    try:
        if name in ROLE_AWARE:
            return TOOLS[name][0](context, role, **arguments)
        return TOOLS[name][0](context, **arguments)
    except (TypeError, ValueError) as error:
        raise ToolError(f"Those aren't valid details for {name}.") from error


def definitions(role):
    return [
        {"type": "function", "name": name, "description": TOOLS[name][2], "parameters": TOOLS[name][3]}
        for name in allowed(role)
    ]
