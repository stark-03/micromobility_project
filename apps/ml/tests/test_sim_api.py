"""M06 HTTP surface: the streaming run endpoint and compare.

The streaming contract is the fragile part — Express parses these lines from a
worker thread, so a change to the shape breaks the run monitor silently. These
tests pin it.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.config import ML_INTERNAL_SECRET
from app.main import app

client = TestClient(app)
AUTH = {"X-Internal-Secret": ML_INTERNAL_SECRET}

SPEC = {
    "seed": 42,
    "simHours": 6.0,
    "startHour": 7.0,
    "zones": [
        {"zoneId": "1", "name": "Camp", "lat": 15.8560, "lng": 74.5060,
         "populationIx": 9.0, "congestionIndex": 0.45},
        {"zoneId": "2", "name": "Tilakwadi", "lat": 15.8430, "lng": 74.4980,
         "populationIx": 7.0, "congestionIndex": 0.30},
    ],
    "fleet": {"scooter": 30, "ebike": 10, "bike": 5},
}


def read_ndjson(response) -> list[dict]:
    return [json.loads(line) for line in response.text.splitlines() if line.strip()]


def run_spec(spec: dict, run_id: str = "test-run") -> list[dict]:
    res = client.post("/internal/sim/run", json={"runId": run_id, "spec": spec}, headers=AUTH)
    assert res.status_code == 200
    return read_ndjson(res)


def test_run_requires_the_internal_secret():
    res = client.post("/internal/sim/run", json={"spec": SPEC})
    assert res.status_code == 401


def test_run_streams_progress_then_exactly_one_result():
    messages = run_spec(SPEC)

    assert len(messages) >= 2
    assert all(m["type"] in {"progress", "result"} for m in messages)
    assert [m["type"] for m in messages].count("result") == 1
    assert messages[-1]["type"] == "result", "the result must be the final line"

    progress = [m for m in messages if m["type"] == "progress"]
    assert progress, "no progress was streamed"
    assert [m["pct"] for m in progress] == sorted(m["pct"] for m in progress)
    assert progress[-1]["pct"] == pytest.approx(1.0)
    assert all(m["runId"] == "test-run" for m in messages)


def test_result_carries_the_full_metric_set():
    result = run_spec(SPEC)[-1]
    metrics = result["metrics"]

    for key in (
        "tripsServed", "tripsUnserved", "serviceRatePct", "meanWaitSeconds",
        "meanTripSeconds", "vehicleUtilizationPct", "distanceLoadedKm",
        "distanceEmptyKm", "co2AvoidedKg", "safetyIncidents", "fleetSize",
    ):
        assert key in metrics, f"missing metric {key}"

    assert result["seed"] == 42
    assert metrics["fleetSize"] == 45
    assert result["timeline"], "timeline must not be empty"
    assert sum(r["tripsServed"] for r in result["timeline"]) == metrics["tripsServed"]


def test_the_endpoint_is_deterministic_across_calls():
    """Determinism has to survive the HTTP boundary, not just the unit test."""
    a = run_spec(SPEC)[-1]
    b = run_spec(SPEC)[-1]
    assert a["metrics"] == b["metrics"]
    assert a["timeline"] == b["timeline"]


def test_invalid_spec_is_rejected_before_the_stream_opens():
    """A bad spec must fail with a status code, not a 200 carrying an error."""
    res = client.post(
        "/internal/sim/run", json={"spec": {**SPEC, "zones": []}}, headers=AUTH
    )
    assert res.status_code == 422


def test_compare_endpoint_returns_direction_labelled_rows():
    small = run_spec({**SPEC, "fleet": {"scooter": 2, "ebike": 0, "bike": 0}})[-1]["metrics"]
    large = run_spec({**SPEC, "fleet": {"scooter": 200, "ebike": 80, "bike": 40}})[-1]["metrics"]

    res = client.post(
        "/internal/sim/compare", json={"baseline": small, "variant": large}, headers=AUTH
    )
    assert res.status_code == 200
    rows = {r["metric"]: r for r in res.json()["rows"]}

    assert rows["tripsServed"]["direction"] == "better"
    assert rows["tripsUnserved"]["direction"] == "better"
    assert rows["tripsUnserved"]["delta"] < 0
