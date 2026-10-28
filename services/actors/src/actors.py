"""Authoritative Terse state. Model optimization runs outside actors."""
import hashlib
import json
from decimal import Decimal, InvalidOperation
from durable_actors import Actor, persisted


def encode(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


class ResearchCampaignActor(Actor):
    state: str = persisted("")

    def initialize(self, config_json: str) -> str:
        if not self.state:
            self.state = encode({"config": json.loads(config_json), "status": "initialized", "reservations": {},
                "consumed_seconds": 0, "best_checkpoint": None, "selection_frozen": False,
                "final_claimed": False, "decisions": [], "version": 0})
        return self.state

    def snapshot(self) -> str:
        return self.state

    def transition(self, status: str, decision: str) -> str:
        s = json.loads(self.state)
        allowed = {"baseline", "diagnosing", "researching", "training", "evaluating", "reviewing", "finalizing", "completed", "failed", "cancelled"}
        if status not in allowed or s["status"] in {"completed", "cancelled"}:
            raise ValueError("Invalid campaign transition")
        s["status"] = status
        s["version"] += 1
        s["decisions"] = [*s["decisions"], {"version": s["version"], "status": status, "reason": decision}]
        self.state = encode(s)
        return self.state

    def reserve(self, experiment_id: str, seconds: int) -> str:
        s = json.loads(self.state)
        if experiment_id in s["reservations"]:
            if s["reservations"][experiment_id]["seconds"] != seconds:
                raise ValueError("Idempotency conflict")
            return self.state
        if seconds <= 0 or s["selection_frozen"] or s["status"] in {"cancelled", "completed", "failed"}:
            raise ValueError("Campaign cannot reserve compute")
        reserved = sum(r["seconds"] for r in s["reservations"].values() if r["status"] == "reserved")
        if reserved + s["consumed_seconds"] + seconds > s["config"]["max_seconds"]:
            raise ValueError("Compute budget exhausted")
        s["reservations"][experiment_id] = {"seconds": seconds, "status": "reserved"}
        self.state = encode(s)
        return self.state

    def settle(self, experiment_id: str, seconds: float) -> str:
        s = json.loads(self.state)
        r = s["reservations"].get(experiment_id)
        if r is None:
            raise ValueError("Reservation required")
        if r["status"] == "settled":
            return self.state
        if seconds < 0 or seconds > r["seconds"]:
            raise ValueError("Usage outside reservation")
        r["status"] = "settled"
        r["actual_seconds"] = seconds
        s["consumed_seconds"] += seconds
        self.state = encode(s)
        return self.state

    def freeze_selection(self, checkpoint_id: str) -> str:
        s = json.loads(self.state)
        if s["selection_frozen"] and s["best_checkpoint"] != checkpoint_id:
            raise ValueError("Checkpoint selection is immutable")
        s["best_checkpoint"] = checkpoint_id
        s["selection_frozen"] = True
        self.state = encode(s)
        return self.state

    def claim_final(self) -> bool:
        s = json.loads(self.state)
        if not s["selection_frozen"] or s["final_claimed"]:
            return False
        s["final_claimed"] = True
        self.state = encode(s)
        return True


class ExperimentActor(Actor):
    state: str = persisted("")

    def initialize(self, spec_json: str) -> str:
        if not self.state:
            self.state = encode({"spec": json.loads(spec_json), "status": "proposed", "metrics": [], "result": None})
        return self.state

    def update(self, status: str, payload_json: str) -> str:
        s = json.loads(self.state)
        transitions = {"proposed": ["approved", "rejected"], "approved": ["training", "failed", "cancelled"],
            "training": ["evaluating", "failed", "cancelled"], "evaluating": ["completed", "failed", "cancelled"]}
        if status != s["status"] and status not in transitions.get(s["status"], []):
            raise ValueError("Invalid experiment transition")
        s["status"] = status
        s["result"] = json.loads(payload_json)
        self.state = encode(s)
        return self.state

    def metric(self, metric_json: str) -> str:
        s = json.loads(self.state)
        m = json.loads(metric_json)
        if s["status"] != "training":
            raise ValueError("Experiment is not training")
        if not any(x["step"] == m["step"] for x in s["metrics"]):
            s["metrics"] = [*s["metrics"], m]
        self.state = encode(s)
        return self.state

    def snapshot(self) -> str:
        return self.state


class GovernanceActor(Actor):
    policy: str = persisted("")
    reviews: str = persisted("{}")
    promoted: str = persisted("")

    def initialize(self, policy_json: str) -> str:
        policy = encode(json.loads(policy_json))
        if self.policy and self.policy != policy:
            raise ValueError("Governance policy is immutable")
        self.policy = policy
        return self.policy

    def review(self, evidence_json: str) -> str:
        e, p = json.loads(evidence_json), json.loads(self.policy)
        reasons = []
        if e.get("reward_version") != p["reward_version"]:
            reasons.append("REWARD_FUNCTION_MODIFIED")
        if e.get("sealed_data_access"):
            reasons.append("SEALED_DATA_ACCESS")
        if not e.get("provenance_valid", False):
            reasons.append("MISSING_PROVENANCE")
        if e.get("phase") == "checkpoint":
            if not e.get("weights_changed"):
                reasons.append("NO_WEIGHT_UPDATE")
            if not e.get("independent_reload"):
                reasons.append("CHECKPOINT_NOT_RELOADED")
            if not e.get("artifact_verified") or len(e.get("sha256", "")) != 64:
                reasons.append("ARTIFACT_INTEGRITY_FAILURE")
            if e.get("regression_drop", 1) > p["max_regression_drop"]:
                reasons.append("REGRESSION_THRESHOLD_EXCEEDED")
        result = {"id": e["id"], "decision": "rejected" if reasons else "approved", "reason_codes": reasons,
            "evidence": e, "policy_version": "forge-policy-v1"}
        reviews = json.loads(self.reviews)
        if e["id"] in reviews and reviews[e["id"]] != result:
            raise ValueError("Review evidence is immutable")
        reviews[e["id"]] = result
        self.reviews = encode(reviews)
        return encode(result)

    def promote(self, checkpoint_id: str, sha256: str) -> str:
        review = json.loads(self.reviews).get(checkpoint_id)
        if not review or review["decision"] != "approved" or review["evidence"].get("phase") != "checkpoint":
            raise ValueError("Checkpoint promotion denied: independent approval required")
        if review["evidence"].get("sha256") != sha256:
            raise ValueError("Checkpoint promotion denied: checksum mismatch")
        self.promoted = checkpoint_id
        return checkpoint_id

    def snapshot(self) -> str:
        return encode({"policy": json.loads(self.policy) if self.policy else {}, "reviews": json.loads(self.reviews), "promoted": self.promoted})


class RLWorldActor(Actor):
    state: str = persisted("")
    hidden_answer: str = persisted("")

    def reset(self, episode_id: str, task: str, answer: str, seed: int) -> str:
        if self.state:
            s = json.loads(self.state)
            if s["episode_id"] == episode_id:
                return self.state
            if not s["terminated"]:
                raise ValueError("Active episode cannot be overwritten")
        self.hidden_answer = answer
        self.state = encode({"episode_id": episode_id, "task": task, "seed": seed, "version": 0,
            "terminated": False, "reward": None, "actions": [], "reward_version": "exact-answer-v1"})
        return self.state

    def observe(self) -> str:
        return self.state

    def step(self, action_json: str) -> str:
        a, s = json.loads(action_json), json.loads(self.state)
        if a["episode_id"] != s["episode_id"]:
            raise ValueError("Episode mismatch")
        existing = next((x for x in s["actions"] if x["action_id"] == a["action_id"]), None)
        if existing:
            if existing["answer"] != a["answer"]:
                raise ValueError("Action ID conflict")
            return self.state
        if a["expected_version"] != s["version"]:
            raise ValueError("State version conflict")
        if s["terminated"]:
            raise ValueError("Episode terminated")
        try:
            correct = Decimal(a["answer"].replace(",", "").strip()) == Decimal(self.hidden_answer)
        except (InvalidOperation, ValueError):
            correct = False
        s["reward"], s["terminated"], s["version"] = int(correct), True, s["version"] + 1
        s["actions"] = [*s["actions"], {"action_id": a["action_id"], "answer": a["answer"], "reward": s["reward"]}]
        s["checksum"] = hashlib.sha256(encode(s).encode()).hexdigest()
        self.state = encode(s)
        return self.state


class ArtifactRegistryActor(Actor):
    registry: str = persisted("{}")

    def register(self, artifact_json: str) -> str:
        a, r = json.loads(artifact_json), json.loads(self.registry)
        if a["id"] in r and r[a["id"]] != a:
            raise ValueError("Immutable artifact conflict")
        if len(a["sha256"]) != 64:
            raise ValueError("SHA-256 required")
        r[a["id"]] = a
        self.registry = encode(r)
        return artifact_json

    def snapshot(self) -> str:
        return self.registry
