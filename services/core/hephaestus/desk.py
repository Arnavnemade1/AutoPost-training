"""The private conversation with Hephaestus in Agent chat: just the lab's owner and the bot.

The lab only answers on this machine, so whoever is typing here is its owner, and is an admin.
"""

import json
import threading
import uuid

from services.core import store
from services.core.hephaestus import brain
from services.core.hephaestus.service import LABEL, Service

KEEP = 200
_lock = threading.Lock()
_waiting = {"count": 0}
_service = {}


def _path():
    return store.DATA / "hephaestus-desk.jsonl"


def _append(sender, text):
    message = {"id": uuid.uuid4().hex, "sender": sender, "text": text, "at": store.now()}
    with open(_path(), "a") as handle:
        handle.write(json.dumps(message) + "\n")
    return message


class Transport:
    """Lets the bot's reporting post here the same way it posts to iMessage."""

    def send(self, _chat_id, text):
        _append("hephaestus", text.removeprefix(LABEL))

    def latest(self):
        return 0

    def read(self, _chat_id, _after):
        return []


def service():
    key = str(store.DATA)
    if key not in _service:
        _service[key] = Service(
            "agent-chat",
            messages=Transport(),
            path=store.DATA / "hephaestus-desk.json",
            surface="agent-chat",
            max_replies_per_hour=240,
        )
    return _service[key]


def history():
    try:
        lines = _path().read_text().splitlines()[-KEEP:]
    except OSError:
        lines = []
    return {
        "messages": [json.loads(line) for line in lines],
        "thinking": _waiting["count"] > 0,
        "model": {
            "connected": brain.connected(),
            "provider": brain.provider() if brain.connected() else None,
        },
    }


def post(text):
    """Record what the owner said. `respond` then does the slow part, off the request."""
    _waiting["count"] += 1
    return _append("you", text)


def respond(text):
    try:
        with _lock:
            bot = service()
            said = brain.address(text)
            reply = brain.answer(bot.context, "admin", said if said is not None else text)
            bot.say(reply or brain.HELP)
            bot.save()
    finally:
        _waiting["count"] -= 1


def watch():
    """Report here when a campaign started here ends, and guard this Mac's memory while it runs."""
    with _lock:
        service().watch()
