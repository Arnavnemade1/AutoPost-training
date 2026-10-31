"""What Hephaestus can do, and who may ask for it. Authority is enforced here, not by the model.

A group chat is untrusted input and the model can be talked into anything, so a tool an asker's role
doesn't allow is neither offered to the model nor run if it is called. Reports hold numbers and names
only: answers, questions and production text never leave the lab through this file.
"""

import os
import re
import subprocess
from datetime import UTC, datetime

import httpx

TERMINAL = {"completed", "cancelled", "failed", "interrupted"}
STRATEGIES = {"broad_sft", "targeted_sft", "dpo"}


class ToolError(Exception):
    """A refusal or failure worth repeating in the chat."""


def _limit(name, default):
    return int(os.environ.get(f"FORGE_HEPHAESTUS_{name}") or default)


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


def _check_id(campaign_id):
    if not re.fullmatch(r"forge-[0-9a-f]{8}", str(campaign_id)):
        raise ToolError("That isn't a campaign id.")


def start_training(context, task_pack, objective=None, strategies=None, experiments=None, train_steps=None):
    """Start the research agents on a task, inside limits no message can raise."""
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    started_today = context.state.setdefault("campaigns_by_day", {}).get(today, 0)
    if started_today >= _limit("DAILY_CAMPAIGNS", 3):
        raise ToolError("I've reached today's limit of campaigns (FORGE_HEPHAESTUS_DAILY_CAMPAIGNS).")
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
    campaign = context.lab.call("POST", "/campaigns", json=config)
    context.state["campaigns_by_day"] = {today: started_today + 1}
    context.state.setdefault("watching", {})[campaign["id"]] = campaign.get("status", "initialized")
    return {
        "started": campaign["id"],
        "limits": {k: config[k] for k in ("max_seconds", "max_experiments", "train_steps")},
    }


def stop_training(context, campaign_id):
    _check_id(campaign_id)
    if campaign_id not in context.state.get("watching", {}):
        raise ToolError("I only stop campaigns I started. Use the command center for others.")
    context.lab.call("POST", f"/campaigns/{campaign_id}/cancel")
    return {"stopping": campaign_id}


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
    "lab_status": (lab_status, False, "Whether a campaign is running, and the Mac's free memory.", NO_ARGS),
    "list_tasks": (list_tasks, False, "The tasks that can be trained.", NO_ARGS),
    "list_campaigns": (list_campaigns, False, "The most recent campaigns and their results.", NO_ARGS),
    "campaign_report": (campaign_report, False, "Measured results of one campaign.", ID_ARG),
    "start_training": (
        start_training,
        True,
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
    "stop_training": (stop_training, True, "Stop a campaign you started.", ID_ARG),
    "request_azure_link": (
        request_azure_link,
        True,
        "Get the request asking a friend to connect their Azure model.",
        {
            "type": "object",
            "properties": {"recipient": {"type": "string"}},
            "additionalProperties": False,
        },
    ),
}


def allowed(role):
    return [name for name, tool in TOOLS.items() if role == "operator" or not tool[1]]


def run(context, role, name, arguments):
    """Run a tool for someone in this role. The one place authority is decided."""
    if name not in TOOLS:
        raise ToolError(f"I have no tool called {name}.")
    if name not in allowed(role):
        raise ToolError("Only an operator can do that.")
    try:
        return TOOLS[name][0](context, **arguments)
    except (TypeError, ValueError) as error:
        raise ToolError(f"Those aren't valid details for {name}.") from error


def definitions(role):
    return [
        {"type": "function", "name": name, "description": TOOLS[name][2], "parameters": TOOLS[name][3]}
        for name in allowed(role)
    ]
