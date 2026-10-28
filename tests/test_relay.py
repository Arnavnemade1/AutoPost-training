import os
import uuid
import httpx
import pytest


@pytest.mark.skipif(
    os.getenv("FORGE_LIVE_RELAY_TEST") != "1", reason="Requires the real local Relay engine and bridge"
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
    first = httpx.post("http://127.0.0.1:7529/message", json=m).json()
    second = httpx.post("http://127.0.0.1:7529/message", json=m).json()
    assert first["message_id"] == second["message_id"]
    assert first["recipient_readback_verified"] is True
