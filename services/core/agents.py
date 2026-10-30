"""Model-backed research agents that can spin up subagents.

Each Forge role (director, data researcher, training engineer, evaluator, governance council)
reasons with its own model call. During that call it may start subagents: focused helpers with
their own brief and the same evidence, run in parallel, whose findings come back to the parent
before it answers. Subagents may start their own helpers down to FORGE_AGENT_DEPTH levels; every
decision is capped at FORGE_AGENT_MAX_CALLS model calls.

Agents advise and propose. Deterministic gates (budgets, provenance, sealed data, integrity and
regression checks) stay authoritative. Final test data is never passed to an agent.

Keys: AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_KEY (Azure's OpenAI-compatible v1 endpoint), or
OPENAI_API_KEY. Models: FORGE_AGENT_MODEL_<ROLE> > FORGE_AGENT_MODEL > FORGE_DIRECTOR_MODEL.
"""

import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor

import httpx

ROLES = {
    "director": "Research director",
    "data": "Data researcher",
    "trainer": "Training engineer",
    "evaluator": "Experiment evaluator",
    "governance": "Governance council",
}

SPAWN_TOOL = {
    "type": "function",
    "name": "spawn_subagents",
    "description": (
        "Start focused subagents that work in parallel on parts of your task. Each gets its own "
        "brief and the same evidence, and returns a written finding. Use them when the evidence "
        "has separable parts (failure clusters, competing hypotheses, independent checks)."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "agents": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string",
                            "description": "Short role, e.g. 'arithmetic-slip analyst'",
                        },
                        "brief": {
                            "type": "string",
                            "description": "Exactly what this subagent must find out",
                        },
                    },
                    "required": ["name", "brief"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["agents"],
        "additionalProperties": False,
    },
    "strict": True,
}

FINDING = {
    "type": "object",
    "properties": {"finding": {"type": "string"}},
    "required": ["finding"],
    "additionalProperties": False,
}

SUBAGENT_INSTRUCTIONS = (
    "You are a subagent started by Forge's {parent}. Work only on your brief, using only the "
    "evidence given. Cite question ids or numbers from the evidence. Be concrete and brief: at "
    "most 120 words. Never ask for final test data."
)


def configured():
    return bool(os.getenv("AZURE_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY"))


def model(role):
    return (
        os.getenv(f"FORGE_AGENT_MODEL_{role.upper()}")
        or os.getenv("FORGE_AGENT_MODEL")
        or os.getenv("FORGE_DIRECTOR_MODEL", "gpt-5-mini")
    )


def provider():
    return "Azure OpenAI" if os.getenv("AZURE_OPENAI_API_KEY") else "OpenAI"


def limits():
    return {
        "max_subagents": int(os.getenv("FORGE_AGENT_MAX_SUBAGENTS", "4")),
        "depth": int(os.getenv("FORGE_AGENT_DEPTH", "2")),
        "max_calls": int(os.getenv("FORGE_AGENT_MAX_CALLS", "12")),
    }


def status():
    """What the API reports: which roles reason with a model, and with which one."""
    return {
        "connected": configured(),
        "provider": provider() if configured() else None,
        "models": {role: model(role) for role in ROLES} if configured() else {},
        "subagents": limits() if configured() else None,
    }


def _post(payload):
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT") or "https://api.openai.com/v1"
    key = os.getenv("AZURE_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
    headers = {"api-key": key} if os.getenv("AZURE_OPENAI_API_KEY") else {"Authorization": f"Bearer {key}"}
    r = httpx.post(endpoint.rstrip("/") + "/responses", headers=headers, json=payload, timeout=120)
    r.raise_for_status()
    return r.json()


class Session:
    """One decision: the agent, its subagents and their subagents, with a shared call budget."""

    def __init__(self, role):
        self.role = role
        self.limits = limits()
        self.calls = 0
        self.usage = {"input_tokens": 0, "output_tokens": 0}
        self.nodes = []
        # Calls promised but not yet made: each spawning agent's answer and each started
        # subagent's first call. Delegation can never spend the budget an answer needs.
        self.held = 0
        self._lock = threading.Lock()

    def _charge(self, raw):
        with self._lock:
            usage = raw.get("usage") or {}
            for k in self.usage:
                self.usage[k] += int(usage.get(k) or 0)

    def _reserve(self, held=False):
        with self._lock:
            if held:
                self.held -= 1
            elif self.calls + self.held >= self.limits["max_calls"]:
                return False
            self.calls += 1
            return True

    def _free(self):
        with self._lock:
            return self.limits["max_calls"] - self.calls - self.held

    def run(self, instructions, evidence, schema, name, depth=0, parent=None, brief=None, prepaid=False):
        node = {
            "agent": name,
            "parent": parent,
            "depth": depth,
            "brief": brief,
            "model": model(self.role),
            "response_ids": [],
            "children": [],
        }
        with self._lock:
            self.nodes.append(node)
        # Delegating costs at least one subagent call plus this agent's answer after it.
        spawn = depth < self.limits["depth"] and self._free() >= 3 + (0 if prepaid else 1)
        payload = {
            "model": node["model"],
            "max_output_tokens": 4000,
            "instructions": instructions
            + (
                f" You can call spawn_subagents (at most {self.limits['max_subagents']} at a time). "
                "Delegate when the evidence has many items (8 or more failures or examples) or "
                "several independent questions: give each subagent one slice or one question, "
                "then combine their findings in your answer. Answer directly when it is small."
                if spawn
                else ""
            ),
            "input": json.dumps({"task": brief, "evidence": evidence} if brief else evidence),
            "text": {"format": {"type": "json_schema", "name": "answer", "strict": True, "schema": schema}},
        }
        if spawn:
            payload["tools"] = [SPAWN_TOOL]
        held = prepaid
        for _round in range(4):
            if not self._reserve(held):
                raise RuntimeError(f"{ROLES[self.role]} exceeded {self.limits['max_calls']} model calls")
            raw = _post(payload)
            self._charge(raw)
            node["response_ids"].append(raw.get("id"))
            calls = [o for o in raw.get("output", []) if o.get("type") == "function_call"]
            if not calls:
                text = "".join(
                    c["text"]
                    for o in raw.get("output", [])
                    for c in o.get("content", []) or []
                    if c.get("type") == "output_text"
                )
                if not text:
                    raise RuntimeError(f"{name} returned no answer")
                node["output"] = json.loads(text)
                return node["output"]
            outputs = []
            for call in calls:
                outputs.append(
                    {
                        "type": "function_call_output",
                        "call_id": call["call_id"],
                        "output": json.dumps(self._spawn(call, evidence, name, depth, node)),
                    }
                )
            held = node.pop("answer_held", False)
            payload = {
                "model": node["model"],
                "max_output_tokens": 4000,
                "previous_response_id": raw["id"],
                "input": outputs,
                "text": payload["text"],
                "tools": [SPAWN_TOOL],
                # One round of delegation per agent; after it, the agent answers.
                "tool_choice": "none",
            }
        raise RuntimeError(f"{name} did not answer")

    def _spawn(self, call, evidence, parent, depth, node):
        try:
            wanted = json.loads(call.get("arguments") or "{}").get("agents") or []
        except json.JSONDecodeError:
            return {"error": "Arguments were not valid JSON; answer with what you have."}
        if node.get("answer_held"):
            return {"error": "Only one spawn_subagents call per answer."}
        with self._lock:
            room = self.limits["max_calls"] - self.calls - self.held - 1
            wanted = wanted[: max(0, min(self.limits["max_subagents"], room))]
            if wanted:
                self.held += 1 + len(wanted)
                node["answer_held"] = True
        if not wanted:
            return {
                "error": "No subagents started (none requested, or the call budget is spent). Answer now."
            }
        instructions = SUBAGENT_INSTRUCTIONS.format(parent=ROLES[self.role].lower())

        def work(spec):
            try:
                found = self.run(
                    instructions,
                    evidence,
                    FINDING,
                    spec["name"][:60],
                    depth + 1,
                    parent=parent,
                    brief=spec["brief"][:1000],
                    prepaid=True,
                )
                return {"name": spec["name"][:60], "finding": found["finding"]}
            except Exception as error:  # A failed helper is reported to its parent, not fatal.
                return {"name": spec["name"][:60], "error": f"{type(error).__name__}: {error}"[:300]}

        with ThreadPoolExecutor(max_workers=len(wanted)) as pool:
            results = list(pool.map(work, wanted))
        node["children"].extend(results)
        return {"results": results}

    def transcript(self):
        return {
            "role": self.role,
            "provider": provider(),
            "calls": self.calls,
            "usage": self.usage,
            "limits": self.limits,
            "agents": self.nodes,
        }

    def subagents(self):
        """Helpers started during this decision, in start order, with their briefs and findings."""
        found = {(c["name"], n["agent"]): c for n in self.nodes for c in n["children"]}
        return [
            {
                "name": n["agent"],
                "parent": n["parent"],
                "depth": n["depth"],
                "brief": n["brief"],
                **{k: v for k, v in found.get((n["agent"], n["parent"]), {}).items() if k != "name"},
            }
            for n in self.nodes
            if n["depth"] > 0
        ]


def consult(role, instructions, evidence, schema):
    """Runs one agent decision. Returns (answer, session)."""
    session = Session(role)
    answer = session.run(instructions, evidence, schema, ROLES[role])
    return answer, session


# ----- Role briefs used by the campaign runner -------------------------------------------------


def _text(schema_fields):
    return {
        "type": "object",
        "properties": {k: v for k, v in schema_fields.items()},
        "required": list(schema_fields),
        "additionalProperties": False,
    }


DATA = (
    "You are Forge's data researcher. Diagnose why the model fails on development questions, "
    "from its actual answers. Group failures into concrete patterns (for example a misread "
    "quantity, an arithmetic slip, a missing final answer, running out of tokens), count them and "
    "cite question ids. Say which training data would address the largest pattern. You cannot "
    "change the objective or data splits."
)
DATA_SCHEMA = _text(
    {
        "summary": {"type": "string"},
        "patterns": {
            "type": "array",
            "items": _text(
                {
                    "pattern": {"type": "string"},
                    "count": {"type": "integer"},
                    "question_ids": {"type": "array", "items": {"type": "string"}},
                }
            ),
        },
        "recommendation": {"type": "string"},
    }
)

TRAINER = (
    "You are Forge's training engineer. Review a finished LoRA training run from its recorded "
    "loss per step and configuration. Say whether it trained normally (loss fell and settled), "
    "diverged, stayed flat or overfit, and what to change next time. Cite step numbers."
)
TRAINER_SCHEMA = _text(
    {
        "assessment": {"type": "string"},
        "healthy": {"type": "boolean"},
        "next_time": {"type": "string"},
    }
)

EVALUATOR = (
    "You are Forge's experiment evaluator. Compare the baseline and the new checkpoint on the "
    "same development questions. The scores are already measured; explain them: what the "
    "checkpoint fixed, what it broke, and whether the change looks like real reasoning or only "
    "answer formatting. Cite question ids. Do not restate the scores as new claims."
)
EVALUATOR_SCHEMA = _text(
    {
        "summary": {"type": "string"},
        "fixed": {"type": "string"},
        "broke": {"type": "string"},
    }
)

GOVERNANCE = (
    "You are a member of Forge's governance council. Deterministic checks (integrity, provenance, "
    "regression, sealed data) have already decided whether this checkpoint may be promoted; you "
    "cannot override them. Give an independent second opinion from the evidence: would you "
    "promote it, and what risk should the team watch? Be specific."
)
GOVERNANCE_SCHEMA = _text(
    {
        "recommendation": {"type": "string", "enum": ["promote", "hold"]},
        "rationale": {"type": "string"},
        "risk": {"type": "string"},
    }
)


def clip(text, n=400):
    text = str(text or "")
    return text if len(text) <= n else text[:n] + "..."


def failures(evaluation, limit=24):
    return [
        {
            "id": p["id"],
            "question": clip(p["question"]),
            "model_answer": clip(p["output"]),
            "expected": clip(p["expected"], 80),
            "finish_reason": p.get("finish_reason"),
        }
        for p in evaluation["predictions"]
        if not p["correct"]
    ][:limit]


def changes(before, after, limit=12):
    pairs = list(zip(before["predictions"], after["predictions"], strict=True))
    row = lambda b, a: {  # noqa: E731
        "id": a["id"],
        "question": clip(a["question"], 300),
        "before": clip(b["output"], 300),
        "after": clip(a["output"], 300),
        "expected": clip(a["expected"], 80),
    }
    return {
        "fixed": [row(b, a) for b, a in pairs if a["correct"] and not b["correct"]][:limit],
        "broke": [row(b, a) for b, a in pairs if b["correct"] and not a["correct"]][:limit],
        "still_wrong": sum(1 for b, a in pairs if not a["correct"] and not b["correct"]),
    }
