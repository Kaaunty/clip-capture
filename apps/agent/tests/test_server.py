import time
from fastapi.testclient import TestClient
from apps.agent.src.server import create_agent_app
from apps.agent.src.config import AgentConfig, CaptureProfileConfig


def make_test_config(tmp_path):
    return AgentConfig(
        field_id="f1",
        central_api_url="https://api.test",
        device_token="valid-token",
        buffer_dir=str(tmp_path / "buf"),
        storage_limit_mb=1000,
        default_profile=CaptureProfileConfig(seconds_before=10, seconds_after=5),
        cameras=[],
    )


def test_duplicate_trigger_rejection(tmp_path):
    config = make_test_config(tmp_path)
    app = create_agent_app(config=config, db_path=tmp_path / "test.db")
    client = TestClient(app)

    now = time.time()
    payload = {"command_id": "cmd-abc", "trigger_source": "PHYSICAL_BUTTON", "timestamp": now}
    headers = {"Authorization": "Bearer valid-token"}

    # First call succeeds
    res1 = client.post("/api/v1/trigger", json=payload, headers=headers)
    assert res1.status_code == 200
    assert res1.json()["status"] == "ACCEPTED"
    assert "event_id" in res1.json()
    evt_id = res1.json()["event_id"]

    # Immediate second call with same command_id is idempotent / deduplicated
    res2 = client.post("/api/v1/trigger", json=payload, headers=headers)
    assert res2.status_code == 200
    assert res2.json()["status"] == "DUPLICATE_IGNORED"
    assert res2.json()["event_id"] == evt_id


def test_button_double_click_within_3s(tmp_path):
    config = make_test_config(tmp_path)
    app = create_agent_app(config=config, db_path=tmp_path / "test.db")
    client = TestClient(app)

    base_time = time.time()
    headers = {"Authorization": "Bearer valid-token"}

    # Button click 1
    p1 = {"command_id": "cmd-1", "trigger_source": "PHYSICAL_BUTTON", "timestamp": base_time}
    r1 = client.post("/api/v1/trigger", json=p1, headers=headers)
    assert r1.status_code == 200
    assert r1.json()["status"] == "ACCEPTED"
    evt1 = r1.json()["event_id"]

    # Rapid button click 2 with different command_id 1.5s later -> duplicate debounce
    p2 = {"command_id": "cmd-2", "trigger_source": "PHYSICAL_BUTTON", "timestamp": base_time + 1.5}
    r2 = client.post("/api/v1/trigger", json=p2, headers=headers)
    assert r2.status_code == 200
    assert r2.json()["status"] == "DUPLICATE_IGNORED"
    assert r2.json()["event_id"] == evt1


def test_button_click_after_3s_accepted(tmp_path):
    config = make_test_config(tmp_path)
    app = create_agent_app(config=config, db_path=tmp_path / "test.db")
    client = TestClient(app)

    base_time = 5000.0
    headers = {"Authorization": "Bearer valid-token"}

    p1 = {"command_id": "cmd-1", "trigger_source": "PHYSICAL_BUTTON", "timestamp": base_time}
    r1 = client.post("/api/v1/trigger", json=p1, headers=headers)
    assert r1.status_code == 200
    assert r1.json()["status"] == "ACCEPTED"

    # Button click 3.5s later -> accepted as new event
    p2 = {"command_id": "cmd-2", "trigger_source": "PHYSICAL_BUTTON", "timestamp": base_time + 3.5}
    r2 = client.post("/api/v1/trigger", json=p2, headers=headers)
    assert r2.status_code == 200
    assert r2.json()["status"] == "ACCEPTED"


def test_api_trigger_not_debounced_by_button_window(tmp_path):
    config = make_test_config(tmp_path)
    app = create_agent_app(config=config, db_path=tmp_path / "test.db")
    client = TestClient(app)

    now = time.time()
    headers = {"Authorization": "Bearer valid-token"}

    # Two API triggers in rapid succession with different command_ids should both be accepted
    p1 = {"command_id": "cmd-api-1", "trigger_source": "API", "timestamp": now}
    r1 = client.post("/api/v1/trigger", json=p1, headers=headers)
    assert r1.status_code == 200
    assert r1.json()["status"] == "ACCEPTED"

    p2 = {"command_id": "cmd-api-2", "trigger_source": "API", "timestamp": now + 0.5}
    r2 = client.post("/api/v1/trigger", json=p2, headers=headers)
    assert r2.status_code == 200
    assert r2.json()["status"] == "ACCEPTED"


def test_auth_token_validation(tmp_path):
    config = make_test_config(tmp_path)
    app = create_agent_app(config=config, db_path=tmp_path / "test.db")
    client = TestClient(app)

    payload = {"command_id": "cmd-auth", "trigger_source": "PHYSICAL_BUTTON"}

    # Missing auth header -> 401
    r_no_auth = client.post("/api/v1/trigger", json=payload)
    assert r_no_auth.status_code == 401

    # Invalid auth header -> 401
    r_bad_auth = client.post(
        "/api/v1/trigger",
        json=payload,
        headers={"Authorization": "Bearer wrong-token"},
    )
    assert r_bad_auth.status_code == 401

    # Valid auth header -> 200
    r_ok = client.post(
        "/api/v1/trigger",
        json=payload,
        headers={"Authorization": "Bearer valid-token"},
    )
    assert r_ok.status_code == 200
    assert r_ok.json()["status"] == "ACCEPTED"


def test_health_endpoint(tmp_path):
    config = make_test_config(tmp_path)
    app = create_agent_app(config=config, db_path=tmp_path / "test.db")
    client = TestClient(app)

    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert res.json()["field_id"] == "f1"
