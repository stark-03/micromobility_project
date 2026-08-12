"""FastAPI entry point for the ML and routing service.

Express is the only permitted caller; the browser never talks to port 8000
(CLAUDE.md, ML service section). Internal routes are prefixed /internal/ and
require the shared secret header.
"""

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .config import ML_INTERNAL_SECRET, SERVICE_NAME, SERVICE_VERSION
from .routing.astar import NoRouteError, plan_route
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
