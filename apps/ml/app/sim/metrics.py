"""Aggregates a finished run into the metrics M06 promises.

MODULES.md M06 outputs: trips served / unserved, mean wait, mean trip time,
vehicle utilization, distance travelled empty vs loaded, congestion delta,
emissions avoided, safety incidents.

One deliberate departure. **Congestion delta is not computed here** — it is a
property of a *pair* of runs, not of one. Producing it from a single run would
mean inventing a denominator for "the city's total car kilometres", and every
number downstream would inherit that fiction. Instead a run reports the
car-kilometres it displaced, and `compare()` turns two of those into the delta a
planner acts on. design.md §5 says results are shown as deltas against a
baseline; this keeps that honest.
"""

from __future__ import annotations

from .engine import RunState
from .scenario import CO2_G_PER_KM, CO2_G_PER_KM_CAR, ScenarioSpec


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def summarise(spec: ScenarioSpec, state: RunState, fleet: list) -> dict:
    """Run state → the metric set the Results screen reads."""
    trips = state.trips
    served = len(trips)
    unserved = len(state.unserved)
    demand = served + unserved

    loaded_m = sum(v.loadedM for v in fleet)
    empty_m = sum(v.emptyM for v in fleet)
    busy_s = sum(v.busySeconds for v in fleet)
    horizon_s = spec.simHours * 3600.0
    fleet_size = len(fleet)

    # Emissions avoided assumes the counterfactual is a car trip. Stating the
    # assumption in the payload matters more than the number itself — a planner
    # who disagrees with the counterfactual can rescale it.
    co2_avoided_g = 0.0
    for t in trips:
        km = t.distanceM / 1000.0
        co2_avoided_g += (CO2_G_PER_KM_CAR - CO2_G_PER_KM[t.kind]) * km

    expected_incidents = sum(t.incidentRisk for t in trips)

    by_kind: dict[str, dict] = {}
    for kind in ("scooter", "ebike", "bike"):
        of_kind = [v for v in fleet if v.kind == kind]
        if not of_kind:
            continue
        by_kind[kind] = {
            "count": len(of_kind),
            "trips": sum(v.trips for v in of_kind),
            "utilizationPct": round(
                100.0 * sum(v.busySeconds for v in of_kind) / (len(of_kind) * horizon_s), 2
            )
            if horizon_s > 0
            else 0.0,
            "meanEndBatteryPct": round(_mean([v.batteryPct for v in of_kind]), 1),
        }

    return {
        "tripsServed": served,
        "tripsUnserved": unserved,
        "demandTotal": demand,
        "serviceRatePct": round(100.0 * served / demand, 2) if demand else 0.0,
        "unservedReasons": dict(sorted(state.unservedReasons.items())),
        "meanWaitSeconds": round(_mean([t.waitSeconds for t in trips]), 1),
        "meanTripSeconds": round(_mean([t.rideSeconds for t in trips]), 1),
        "meanTripDistanceM": round(_mean([t.distanceM for t in trips]), 1),
        "vehicleUtilizationPct": round(100.0 * busy_s / (fleet_size * horizon_s), 2)
        if fleet_size and horizon_s
        else 0.0,
        "distanceLoadedKm": round(loaded_m / 1000.0, 2),
        "distanceEmptyKm": round(empty_m / 1000.0, 2),
        "emptyRatioPct": round(100.0 * empty_m / (loaded_m + empty_m), 2)
        if (loaded_m + empty_m) > 0
        else 0.0,
        # The displacement figure congestion delta is derived from.
        "carKmReplaced": round(loaded_m / 1000.0, 2),
        "co2AvoidedKg": round(co2_avoided_g / 1000.0, 3),
        # Expected incidents, not a sampled count — see engine.incident_risk().
        "safetyIncidents": round(expected_incidents, 3),
        "incidentsPer1000Km": round(1000.0 * expected_incidents / (loaded_m / 1000.0), 4)
        if loaded_m > 0
        else 0.0,
        "rebalanceMoves": state.rebalanceMoves,
        "rebalanceDistanceKm": round(state.rebalanceDistanceM / 1000.0, 2),
        "fleetSize": fleet_size,
        "byKind": by_kind,
    }


def timeline(spec: ScenarioSpec, state: RunState, bucket_minutes: int = 30) -> list[dict]:
    """Per-bucket series for the run's charts.

    Bucketed rather than per-event: a 24-hour run serves tens of thousands of
    trips, and no chart benefits from more points than pixels.
    """
    bucket_s = bucket_minutes * 60.0
    buckets = int((spec.simHours * 3600.0) // bucket_s) + 1

    served = [0] * buckets
    unserved = [0] * buckets
    wait_sum = [0.0] * buckets
    incidents = [0.0] * buckets

    for t in state.trips:
        i = min(buckets - 1, int(t.startedAt // bucket_s))
        served[i] += 1
        wait_sum[i] += t.waitSeconds
        incidents[i] += t.incidentRisk

    for a in state.unserved:
        i = min(buckets - 1, int(a.at // bucket_s))
        unserved[i] += 1

    return [
        {
            "bucket": i,
            "simMinutes": int(i * bucket_minutes),
            "tripsServed": served[i],
            "tripsUnserved": unserved[i],
            "meanWaitSeconds": round(wait_sum[i] / served[i], 1) if served[i] else 0.0,
            "safetyIncidents": round(incidents[i], 3),
        }
        for i in range(buckets)
    ]


# Metrics where a larger number is the worse outcome. Compare needs this to
# label a delta "better" or "worse" rather than leaving the sign to be read.
LOWER_IS_BETTER = {
    "tripsUnserved",
    "meanWaitSeconds",
    "meanTripSeconds",
    "distanceEmptyKm",
    "emptyRatioPct",
    "safetyIncidents",
    "incidentsPer1000Km",
    "rebalanceDistanceKm",
}

COMPARABLE = [
    "tripsServed",
    "tripsUnserved",
    "serviceRatePct",
    "meanWaitSeconds",
    "meanTripSeconds",
    "vehicleUtilizationPct",
    "distanceLoadedKm",
    "distanceEmptyKm",
    "emptyRatioPct",
    "carKmReplaced",
    "co2AvoidedKg",
    "safetyIncidents",
    "incidentsPer1000Km",
]


def compare(baseline: dict, variant: dict) -> list[dict]:
    """Baseline vs variant, as deltas.

    design.md §5: "results are shown as deltas with the absolute value
    secondary, because the delta is what a planner acts on."
    """
    rows: list[dict] = []

    for key in COMPARABLE:
        if key not in baseline or key not in variant:
            continue
        b, v = float(baseline[key]), float(variant[key])
        delta = v - b
        pct = (delta / b * 100.0) if b else None

        if delta == 0:
            direction = "same"
        elif key in LOWER_IS_BETTER:
            direction = "better" if delta < 0 else "worse"
        else:
            direction = "better" if delta > 0 else "worse"

        rows.append(
            {
                "metric": key,
                "baseline": round(b, 3),
                "variant": round(v, 3),
                "delta": round(delta, 3),
                "deltaPct": round(pct, 2) if pct is not None else None,
                "direction": direction,
            }
        )

    return rows
