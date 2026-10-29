import os
import uuid
import httpx
import pytest

BRIDGE = os.getenv("FORGE_RELAY_BRIDGE", "http://127.0.0.1:7529")


@pytest.mark.skipif(
    os.getenv("FORGE_LIVE_RELAY_TEST") != "1",
    reason="Requires a running Relay bridge (FORGE_RELAY_BRIDGE, local or hosted engine)",
)
def test_real_relay_assignment_readback_and_duplicate_send():
    m = {
        "id": "test-" + uuid.uuid4().hex,
        "campaign_id": "transport-test",
        "sender": "director",
        "recipient": "trainer",
        "category": "VERIFY_ASSIGNMENT",
        "text": "Verify exact recipient bytes before authorizing work.",
    }
    first = httpx.post(BRIDGE + "/message", json=m, timeout=30).json()
    second = httpx.post(BRIDGE + "/message", json=m, timeout=30).json()
    assert first["message_id"] == second["message_id"]
    assert first["recipient_readback_verified"] is True
    assert first["room"]["readback_verified"] is True
    assert set(first["room"]["readers"]) == {"director", "data", "trainer", "evaluator", "governance"}
    assert second["room"]["message_id"] == first["room"]["message_id"]
