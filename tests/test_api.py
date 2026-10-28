from concurrent.futures import ThreadPoolExecutor
import json
import time
from fastapi.testclient import TestClient
from services import api
from services.core import store


def test_single_gpu_slot_serializes_concurrent_launches(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path)
    output = tmp_path / "artifacts"
    output.mkdir()
    monkeypatch.setattr(store, "ARTIFACTS", output)

    class CampaignAuthority:
        def initialize(self, _config):
            return json.dumps({"status": "initialized"})

    class GovernanceAuthority:
        def initialize(self, _policy):
            return "{}"

    starts = []

    def spawn(cid):
        time.sleep(0.03)
        starts.append(cid)

    monkeypatch.setattr(api, "actor", lambda _: CampaignAuthority())
    monkeypatch.setattr(api, "governance", lambda _: GovernanceAuthority())
    monkeypatch.setattr(api, "spawn", spawn)
    with TestClient(api.app) as c:

        def create(_):
            return c.post("/campaigns", json={}).status_code

        with ThreadPoolExecutor(6) as pool:
            results = list(pool.map(create, range(6)))
        assert results.count(201) == 1
        assert results.count(409) == 5
        assert len(starts) == 1
        campaign_id = starts[0]
        assert c.post(f"/campaigns/{campaign_id}/cancel").status_code == 200
        assert store.get(campaign_id)["cancel_requested"] is True


def test_unknown_config_rejected_and_cross_origin_mutations_blocked():
    with TestClient(api.app) as c:
        assert c.post("/campaigns", json={"arbitrary_command": "no"}).status_code == 422
        assert (
            c.post("/campaigns", json={}, headers={"origin": "https://untrusted.example"}).status_code == 403
        )
        assert c.get("/campaigns/no-such-campaign").status_code == 404
