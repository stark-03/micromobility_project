"""Rebalancing as a min-cost transportation problem.

MODULES.md M07: "Solve rebalancing as a min-cost transportation problem (SciPy
/ OR-Tools) under van capacity and shift-hour constraints."

The same solver runs in two places, deliberately:

  - `POST /internal/fleet/rebalance` — Express asks for a plan for the real
    fleet, and turns the answer into crew tasks.
  - The M06 simulator's rebalancing lever.

One implementation means a planner who simulates rebalancing and then switches
it on is testing the algorithm they will actually run. Two implementations
would drift, and the drift would be invisible: both keep returning plausible
plans, they just stop being the same plan.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy.optimize import linprog

R_EARTH_M = 6_371_000.0


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Kilometres between two (lat, lng) points."""
    lat1, lng1 = math.radians(a[0]), math.radians(a[1])
    lat2, lng2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlng = lat2 - lat1, lng2 - lng1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * R_EARTH_M * math.asin(math.sqrt(h)) / 1000.0


@dataclass
class ZoneState:
    """One zone's supply and expected demand over the planning horizon."""

    zoneId: str
    name: str
    lat: float
    lng: float
    supply: int
    demand: float

    @property
    def gap(self) -> float:
        """Positive = more vehicles than needed. Negative = short."""
        return self.supply - self.demand


@dataclass
class Move:
    fromZoneId: str
    toZoneId: str
    vehicles: int
    distanceKm: float


@dataclass
class RebalancePlan:
    moves: list[Move]
    totalVehicles: int
    totalDistanceKm: float
    deficitBefore: float
    deficitAfter: float
    status: str
    notes: list[str]


def solve_rebalance(
    zones: list[ZoneState],
    van_count: int = 2,
    van_capacity: int = 8,
    value_per_vehicle_km: float = 6.0,
) -> RebalancePlan:
    """Min-cost transportation solve: surplus zones -> deficit zones.

    **Why this is not simply "minimise distance".** Minimising travel cost with
    no obligation to move anything has an obvious optimum: move nothing, cost
    zero. The objective has to price the *benefit* of a relocation against its
    cost, so each unit moved carries `-value_per_vehicle_km` and each kilometre
    carries `+1`. A move happens only where it pays for itself, which is the
    real decision: hauling a scooter 9 km to cover one extra trip is not worth
    a van's time, and a solver that does it anyway is not optimising, it is
    just busy.

    `value_per_vehicle_km` is therefore the operator's dial, in kilometres: "a
    vehicle in the right place is worth up to this much driving".

    **Why the LP gives whole vehicles.** The constraint matrix of a
    transportation problem is totally unimodular, so with integral supplies and
    capacities every basic feasible solution is integral. No branch and bound
    is needed and no rounding is applied — the values come back whole. Rounding
    an LP relaxation by hand is where this kind of code usually goes wrong.
    """
    notes: list[str] = []

    surplus = [z for z in zones if z.gap > 0.5]
    deficit = [z for z in zones if z.gap < -0.5]

    deficit_before = sum(-z.gap for z in deficit)

    if not surplus or not deficit:
        notes.append(
            "nothing to move: no zone has spare vehicles"
            if not surplus
            else "nothing to move: no zone is short"
        )
        return RebalancePlan([], 0, 0.0, deficit_before, deficit_before, "no_action", notes)

    fleet_capacity = van_count * van_capacity
    if fleet_capacity <= 0:
        notes.append("no van capacity available")
        return RebalancePlan([], 0, 0.0, deficit_before, deficit_before, "no_action", notes)

    n_s, n_d = len(surplus), len(deficit)

    # Cost per unit moved from i to j, net of the benefit of arriving.
    cost = np.zeros(n_s * n_d)
    dist = np.zeros(n_s * n_d)
    for i, s in enumerate(surplus):
        for j, d in enumerate(deficit):
            km = haversine_km((s.lat, s.lng), (d.lat, d.lng))
            dist[i * n_d + j] = km
            cost[i * n_d + j] = km - value_per_vehicle_km

    # sum_j x_ij <= surplus_i
    a_ub: list[list[float]] = []
    b_ub: list[float] = []
    for i, s in enumerate(surplus):
        row = [0.0] * (n_s * n_d)
        for j in range(n_d):
            row[i * n_d + j] = 1.0
        a_ub.append(row)
        b_ub.append(float(int(s.gap)))

    # sum_i x_ij <= deficit_j
    for j, d in enumerate(deficit):
        row = [0.0] * (n_s * n_d)
        for i in range(n_s):
            row[i * n_d + j] = 1.0
        a_ub.append(row)
        b_ub.append(float(math.ceil(-d.gap)))

    # Shift constraint: the crews can only carry so much in one round.
    a_ub.append([1.0] * (n_s * n_d))
    b_ub.append(float(fleet_capacity))

    result = linprog(
        c=cost,
        A_ub=np.array(a_ub),
        b_ub=np.array(b_ub),
        bounds=(0, None),
        method="highs",
    )

    if not result.success:
        notes.append(f"solver failed: {result.message}")
        return RebalancePlan([], 0, 0.0, deficit_before, deficit_before, "failed", notes)

    moves: list[Move] = []
    total_vehicles = 0
    total_km = 0.0

    x = result.x
    for i, s in enumerate(surplus):
        for j, d in enumerate(deficit):
            # Integral by total unimodularity; round only to shed float dust
            # like 2.9999999996, never to make a fractional answer whole.
            qty = int(round(x[i * n_d + j]))
            if qty <= 0:
                continue
            # float(): numpy scalars leak through pydantic and JSON encoding
            # in ways that bite far from here. Cast at the boundary.
            km = float(dist[i * n_d + j])
            moves.append(
                Move(fromZoneId=s.zoneId, toZoneId=d.zoneId, vehicles=qty, distanceKm=round(km, 3))
            )
            total_vehicles += qty
            total_km += km * qty

    # Longest hauls first: if a shift is cut short, the moves that were hardest
    # to justify are the ones left undone.
    moves.sort(key=lambda m: (-m.distanceKm, m.fromZoneId, m.toZoneId))

    filled = sum(m.vehicles for m in moves)
    deficit_after = max(0.0, deficit_before - filled)

    if total_vehicles == fleet_capacity:
        notes.append(f"van capacity ({fleet_capacity}) is the binding constraint — add a van")
    if total_vehicles == 0:
        notes.append(
            f"no move pays for itself at {value_per_vehicle_km} km of value per vehicle; "
            "zones that are short are too far from zones with spare stock"
        )

    return RebalancePlan(
        moves=moves,
        totalVehicles=total_vehicles,
        totalDistanceKm=round(total_km, 2),
        deficitBefore=round(deficit_before, 2),
        deficitAfter=round(deficit_after, 2),
        status="planned" if moves else "no_action",
        notes=notes,
    )


@dataclass
class ChargingCandidate:
    vehicleId: str
    zoneId: str
    batteryPct: float
    priority: float


def plan_charging(
    vehicles: list[dict],
    zones: list[ZoneState],
    crew_capacity: int = 10,
    min_battery_pct: float = 30.0,
) -> list[ChargingCandidate]:
    """Which flat vehicles to collect, cheapest availability loss first.

    MODULES.md M07: "pick low-battery units whose removal costs the least
    availability." Two things pull against each other — a nearly flat vehicle
    is the most urgent to collect, but pulling it from a zone that is already
    short makes that zone worse. Priority is the trade: urgency scaled by how
    much the zone can spare it.
    """
    gap_by_zone = {z.zoneId: z.gap for z in zones}
    candidates: list[ChargingCandidate] = []

    for v in vehicles:
        battery = float(v.get("batteryPct") or 0.0)
        if battery >= min_battery_pct:
            continue

        zone_id = str(v.get("zoneId") or "")
        gap = gap_by_zone.get(zone_id, 0.0)

        # Urgency rises as the battery falls. The zone term is >1 where there
        # is spare stock and <1 where the zone is already short, so a flat
        # vehicle in a starved zone waits behind one in a well-stocked zone.
        urgency = (min_battery_pct - battery) / min_battery_pct
        zone_factor = 1.0 + max(-0.8, min(1.0, gap / 10.0))

        candidates.append(
            ChargingCandidate(
                vehicleId=str(v.get("vehicleId")),
                zoneId=zone_id,
                batteryPct=round(battery, 1),
                priority=round(urgency * zone_factor, 4),
            )
        )

    candidates.sort(key=lambda c: (-c.priority, c.vehicleId))
    return candidates[:crew_capacity]
