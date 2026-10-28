"""Retries are limited to operations whose application-level IDs are idempotent."""

import time
from durable_actors.client import Client, ActorInvocationError
from services.actors.generated import actors

SAFE = {
    "snapshot",
    "observe",
    "initialize",
    "transition",
    "reserve",
    "settle",
    "freeze_selection",
    "update",
    "metric",
    "review",
    "promote",
    "register",
    "reset",
    "step",
}


class ReconciledTransport:
    def __init__(self, client=None):
        self.client = client or Client()

    def invoke(self, actor_name, actor_id, method, args):
        for attempt in range(4):
            try:
                return self.client.invoke(actor_name, actor_id, method, args)
            except ActorInvocationError as error:
                if method not in SAFE or error.code not in {"outcome_unknown", "unavailable"} or attempt == 3:
                    raise
                time.sleep(0.25 * (attempt + 1))

    def __getattr__(self, name):
        return getattr(self.client, name)


transport = ReconciledTransport()


def get_actor(name, identity):
    return getattr(actors, name).get(identity, transport)
