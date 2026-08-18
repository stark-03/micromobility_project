"""FastAPI entry point for the ML and routing service.

Express is the only permitted caller; the browser never talks to port 8000
(CLAUDE.md, ML service section). Internal routes are prefixed /internal/ and
require the shared secret header.
"""

import json

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .config import ML_INTERNAL_SECRET, SERVICE_NAME, SERVICE_VERSION
from .fleet.rebalance import ZoneState, plan_charging, solve_rebalance
from .sim.engine import Simulation
from .sim.metrics import compare, summarise, timeline
from .sim.scenario import ScenarioSpec
from .routing.astar import NoRouteError, plan_route
from .models.demand import (
    has_model,
    model_version,
    predict_demand,
    train_demand_model,
    training_result_dict,
)
from .routing.costs import PROFILES

app = FastAPI(title=SERVICE_NAME, version=SERVICE_VERSION)


def require_secret(x_internal_secret: str | None) -> None:
    if x_internal_secret != ML_INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="Invalid internal secret")


class Edge(BaseModel):
    segmentId: str
    fromNode: str
    toNode: str
    lengthM: float
    speedFreeKph: float
    congestionIndex: float = 0.0
    gradientPct: float = 0.0
    roadClass: str = "local"
    oneWay: bool = False
    name: str | None = None
    safetyScore: float = 70.0
    geometry: list[list[float]] = Field(default_factory=list)


class PlanRequest(BaseModel):
    origin: list[float] = Field(..., min_length=2, max_length=2, description="[lng, lat]")
    destination: list[float] = Field(..., min_length=2, max_length=2)
    mode: str = "scooter"
    profile: str = "fastest"
    edges: list[Edge]


class CompareRequest(BaseModel):
    origin: list[float] = Field(..., min_length=2, max_length=2)
    destination: list[float] = Field(..., min_length=2, max_length=2)
    mode: str = "scooter"
    edges: list[Edge]


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "service": SERVICE_NAME, "version": SERVICE_VERSION}


@app.get("/internal/routing/profiles")
def profiles(x_internal_secret: str | None = Header(default=None)) -> dict:
    require_secret(x_internal_secret)
    return {
        "profiles": [
            {
                "name": p.name,
                "weights": {
                    "distance": p.w_distance,
                    "congestion": p.w_congestion,
                    "safety": p.w_safety,
                    "gradient": p.w_gradient,
                },
            }
            for p in PROFILES.values()
        ]
    }


@app.post("/internal/routing/plan")
def routing_plan(body: PlanRequest, x_internal_secret: str | None = Header(default=None)) -> dict:
    require_secret(x_internal_secret)

    profile = PROFILES.get(body.profile)
    if profile is None:
        raise HTTPException(status_code=400, detail=f"Unknown profile '{body.profile}'")

    try:
        return plan_route(
            [e.model_dump() for e in body.edges],
            (body.origin[0], body.origin[1]),
            (body.destination[0], body.destination[1]),
            profile,
            body.mode,
        )
    except NoRouteError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/internal/routing/compare")
def routing_compare(
    body: CompareRequest, x_internal_secret: str | None = Header(default=None)
) -> dict:
    """All three profiles for one origin/destination pair.

    The point of the Plan screen is the comparison — a planner wants to see what
    choosing 'safest' actually costs in minutes.
    """
    require_secret(x_internal_secret)
    edges = [e.model_dump() for e in body.edges]

    routes = []
    for profile in PROFILES.values():
        try:
            routes.append(
                plan_route(
                    edges,
                    (body.origin[0], body.origin[1]),
                    (body.destination[0], body.destination[1]),
                    profile,
                    body.mode,
                )
            )
        except NoRouteError:
            # One profile may be unroutable (mode restrictions) while others are
            # fine. Returning the rest beats failing the whole comparison.
            continue

    if not routes:
        raise HTTPException(status_code=422, detail="No route exists between those points")
    return {"routes": routes}


# ---- M05 demand prediction --------------------------------------------------


class HistoryRow(BaseModel):
    zone_id: str
    slot_start: str
    trips: float
    population_ix: float = 6.0
    precipitation_mm: float = 0.0
    temp_c: float = 25.0


class TrainRequest(BaseModel):
    history: list[HistoryRow]
    valid_days: int = Field(default=7, ge=1, le=30)


class PredictRequest(BaseModel):
    history: list[HistoryRow]
    horizon_slots: int = Field(default=4, ge=1, le=96)


@app.post("/internal/ml/train")
def ml_train(body: TrainRequest, x_internal_secret: str | None = Header(default=None)) -> dict:
    """Fit the demand model.

    Training is always a job, never a request handler (CLAUDE.md) — Express
    calls this from its job runner, not from a user-facing route.
    """
    require_secret(x_internal_secret)
    try:
        result = train_demand_model(
            [h.model_dump() for h in body.history], valid_days=body.valid_days
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return training_result_dict(result)


@app.post("/internal/ml/predict/demand")
def ml_predict_demand(
    body: PredictRequest, x_internal_secret: str | None = Header(default=None)
) -> dict:
    require_secret(x_internal_secret)
    if not has_model():
        raise HTTPException(status_code=409, detail="No trained model. Train first.")
    return {
        "modelVersion": model_version(),
        "forecasts": predict_demand(
            [h.model_dump() for h in body.history], horizon_slots=body.horizon_slots
        ),
    }


@app.get("/internal/ml/models")
def ml_models(x_internal_secret: str | None = Header(default=None)) -> dict:
    require_secret(x_internal_secret)
    return {"loaded": has_model(), "version": model_version()}


# ---- M06 simulation ---------------------------------------------------------


class SimRunRequest(BaseModel):
    runId: str = "adhoc"
    spec: ScenarioSpec
    timelineBucketMinutes: int = Field(default=30, ge=5, le=120)


class SimCompareRequest(BaseModel):
    baseline: dict
    variant: dict


@app.post("/internal/sim/run")
def sim_run(body: SimRunRequest, x_internal_secret: str | None = Header(default=None)):
    """Runs one scenario, streaming progress as newline-delimited JSON.

    NDJSON rather than a plain JSON body because a long run must not look like a
    hung request. Express reads this stream from its job worker, forwards each
    `progress` line to the `run:<id>` socket room, and persists the final
    `result` line. A client that does not care about progress can simply read to
    the last line.

    Streaming also means the response starts immediately, so an operator sees
    the run move rather than watching a spinner and wondering if it died.
    """
    require_secret(x_internal_secret)

    def lines():
        try:
            sim = Simulation(body.spec)
            for snapshot in sim.run_iter():
                yield json.dumps({"type": "progress", "runId": body.runId, **snapshot}) + "\n"

            yield json.dumps(
                {
                    "type": "result",
                    "runId": body.runId,
                    "seed": body.spec.seed,
                    "metrics": summarise(body.spec, sim.state, sim.fleet),
                    "timeline": timeline(body.spec, sim.state, body.timelineBucketMinutes),
                }
            ) + "\n"
        except Exception as exc:  # noqa: BLE001
            # The response has already begun, so the status code is committed to
            # 200 and an error cannot be signalled by one. It has to travel in
            # the stream, and Express keys on `type` to tell the cases apart.
            yield json.dumps({"type": "error", "runId": body.runId, "message": str(exc)}) + "\n"

    return StreamingResponse(lines(), media_type="application/x-ndjson")


@app.post("/internal/sim/compare")
def sim_compare(
    body: SimCompareRequest, x_internal_secret: str | None = Header(default=None)
) -> dict:
    """Baseline vs variant as signed, direction-labelled deltas."""
    require_secret(x_internal_secret)
    return {"rows": compare(body.baseline, body.variant)}


# ---- M07 fleet optimisation -------------------------------------------------


class ZoneStateIn(BaseModel):
    zoneId: str
    name: str = ""
    lat: float
    lng: float
    supply: int = Field(..., ge=0)
    demand: float = Field(..., ge=0)


class RebalanceRequest(BaseModel):
    zones: list[ZoneStateIn] = Field(..., min_length=1)
    vanCount: int = Field(default=2, ge=0, le=50)
    vanCapacity: int = Field(default=8, ge=1, le=50)
    # How far a van will drive to place one vehicle, in km. The operator's dial.
    valuePerVehicleKm: float = Field(default=6.0, ge=0.0, le=200.0)


class ChargingRequest(BaseModel):
    zones: list[ZoneStateIn] = Field(..., min_length=1)
    vehicles: list[dict] = Field(default_factory=list)
    crewCapacity: int = Field(default=10, ge=1, le=200)
    minBatteryPct: float = Field(default=30.0, ge=0.0, le=100.0)


def _states(zones: list[ZoneStateIn]) -> list[ZoneState]:
    return [
        ZoneState(
            zoneId=z.zoneId, name=z.name, lat=z.lat, lng=z.lng, supply=z.supply, demand=z.demand
        )
        for z in zones
    ]


@app.post("/internal/fleet/rebalance")
def fleet_rebalance(
    body: RebalanceRequest, x_internal_secret: str | None = Header(default=None)
) -> dict:
    """Min-cost transportation solve: surplus zones -> deficit zones.

    The same function the M06 simulator calls for its rebalancing lever, so a
    planner who simulates the policy is testing the algorithm crews will run.
    """
    require_secret(x_internal_secret)

    plan = solve_rebalance(
        _states(body.zones),
        van_count=body.vanCount,
        van_capacity=body.vanCapacity,
        value_per_vehicle_km=body.valuePerVehicleKm,
    )

    return {
        "status": plan.status,
        "totalVehicles": plan.totalVehicles,
        "totalDistanceKm": plan.totalDistanceKm,
        "deficitBefore": plan.deficitBefore,
        "deficitAfter": plan.deficitAfter,
        "notes": plan.notes,
        "moves": [
            {
                "fromZoneId": m.fromZoneId,
                "toZoneId": m.toZoneId,
                "vehicles": m.vehicles,
                "distanceKm": m.distanceKm,
            }
            for m in plan.moves
        ],
    }


@app.post("/internal/fleet/charging")
def fleet_charging(
    body: ChargingRequest, x_internal_secret: str | None = Header(default=None)
) -> dict:
    """Which flat vehicles to collect, cheapest availability loss first."""
    require_secret(x_internal_secret)

    picks = plan_charging(
        body.vehicles,
        _states(body.zones),
        crew_capacity=body.crewCapacity,
        min_battery_pct=body.minBatteryPct,
    )
    return {
        "candidates": [
            {
                "vehicleId": c.vehicleId,
                "zoneId": c.zoneId,
                "batteryPct": c.batteryPct,
                "priority": c.priority,
            }
            for c in picks
        ]
    }
