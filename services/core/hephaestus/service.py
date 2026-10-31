"""The running bot: reads new messages in its one group chat, answers, and reports on its campaigns."""

import json
import os
import time
from types import SimpleNamespace

from services.core import store
from services.core.hephaestus import brain, imessage, tools

LABEL = "⚒️ Hephaestus\n"
TICK_SECONDS = 5
WATCH_SECONDS = 30
MAX_REPLIES_PER_HOUR = 30
ECHO_SECONDS = 60
ENDED = {
    "completed": "finished",
    "failed": "failed",
    "cancelled": "was stopped",
    "interrupted": "was interrupted",
}


def _handle(value):
    value = value.strip().lower()
    return value.replace(" ", "").replace("-", "").replace("(", "").replace(")", "")


def operators():
    return {_handle(h) for h in os.environ.get("FORGE_HEPHAESTUS_OPERATORS", "").split(",") if h.strip()}


def owners():
    return {_handle(h) for h in os.environ.get("FORGE_HEPHAESTUS_OWNER", "").split(",") if h.strip()}


def role_of(message):
    """Apple's own sender identity decides this. Anything said in a message has no bearing on it."""
    sender = _handle(message["sender"]) if message["sender"] else None
    if message["mine"] or sender in owners():
        return "admin"
    return "operator" if sender in operators() else "viewer"


class Service:
    def __init__(
        self,
        chat_id,
        lab=None,
        messages=imessage,
        post=None,
        path=None,
        clock=time.monotonic,
        surface="imessage",
        max_replies_per_hour=MAX_REPLIES_PER_HOUR,
    ):
        self.chat_id, self.messages, self.clock = chat_id, messages, clock
        self.post = post
        self.path = path or store.DATA / "hephaestus.json"
        self.state = self._load()
        self.context = SimpleNamespace(lab=lab or tools.Lab(), state=self.state, surface=surface)
        self.max_replies_per_hour = max_replies_per_hour
        self.recent_texts = {}
        self.last_watch = None

    def _load(self):
        try:
            return json.loads(self.path.read_text())
        except (OSError, ValueError):
            return {}

    def save(self):
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.state))
        temporary.replace(self.path)

    def say(self, text):
        """Post to the chat, under the label, within a limit that stops any runaway loop."""
        now = time.time()
        recent = [t for t in self.state.get("replies", []) if now - t < 3600]
        if len(recent) >= self.max_replies_per_hour:
            print("Reply limit reached; not posting.", flush=True)
            return
        self.state["replies"] = [*recent, now]
        self.save()
        try:
            self.messages.send(self.chat_id, LABEL + text[: brain.MAX_REPLY])
        except (imessage.MessagesError, OSError) as error:
            print(f"Could not post: {error}", flush=True)

    def handle(self, message):
        said = brain.address(message["text"])
        if said is None:
            return
        if self._is_echo(said):
            return
        args = (self.context, role_of(message), said)
        reply = brain.answer(*args, self.post) if self.post else brain.answer(*args)
        self.say(reply)

    def _is_echo(self, said):
        """Messaging yourself stores each message twice, as sent and as received."""
        if ";-;" not in self.chat_id:
            return False
        now = self.clock()
        self.recent_texts = {t: at for t, at in self.recent_texts.items() if now - at < ECHO_SECONDS}
        seen = said in self.recent_texts
        self.recent_texts[said] = now
        return seen

    def read_new(self):
        if "cursor" not in self.state:
            # Start from now: nothing said before Hephaestus joined is acted on.
            self.state["cursor"] = self.messages.latest()
            self.save()
            return
        for message in self.messages.read(self.chat_id, self.state["cursor"]):
            # Saved before acting: a crash must not start the same training run twice.
            self.state["cursor"] = message["rowid"]
            self.save()
            try:
                self.handle(message)
            except Exception as error:
                print(f"Could not handle a message: {type(error).__name__}", flush=True)
            self.save()

    def watch(self):
        """Report when a campaign it started ends, and stop one if this Mac runs short of memory."""
        watching = self.state.get("watching", {})
        if not watching:
            return
        try:
            campaigns = {c["id"]: c for c in self.context.lab.call("GET", "/campaigns")}
        except tools.ToolError:
            return  # The lab is down. Campaign state is durable, so this catches up when it returns.
        for cid in list(watching):
            campaign = campaigns.get(cid)
            if campaign is None:
                del watching[cid]
            elif campaign["status"] in tools.TERMINAL:
                del watching[cid]
                self.state.setdefault("finished", []).append(cid)
                self.state["finished"] = self.state["finished"][-20:]
                self.say(self._ending(campaign))
            elif tools.runs_here():
                self._guard_memory(cid, watching)
        self.save()

    def _guard_memory(self, cid, watching):
        free = tools.free_memory_percent()
        floor = int(os.environ.get("FORGE_HEPHAESTUS_STOP_FREE_MEMORY") or 10)
        if free is not None and free < floor and watching[cid] != "stopping":
            self.context.lab.call("POST", f"/campaigns/{cid}/cancel")
            watching[cid] = "stopping"
            self.say(f"This Mac has only {free}% of its memory free, so I'm stopping {cid}.")

    @staticmethod
    def _ending(campaign):
        brief = tools._brief(campaign)
        line = f"{brief['id']} {ENDED[campaign['status']]}."
        claim = brief["improvement_claim"]
        if claim == "validated":
            return f"{line} Validated improvement of {brief['improvement_points']} points."
        if claim == "uncertain":
            return f"{line} The score rose {brief['improvement_points']} points, but that's within noise."
        if claim == "none":
            return f"{line} No improvement, so nothing is claimed."
        return line

    def tick(self):
        self.read_new()
        now = self.clock()
        if self.last_watch is None or now - self.last_watch >= WATCH_SECONDS:
            self.last_watch = now
            self.watch()

    def run(self):
        while True:
            try:
                self.tick()
            except imessage.MessagesError as error:
                print(error, flush=True)
                return 2
            time.sleep(TICK_SECONDS)
