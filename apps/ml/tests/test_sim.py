"""M06 simulation engine tests.

design.md §9 names two that are not optional:
  - a determinism test asserting identical metrics across two runs with one seed
  - a conservation test: no vehicle exists in two places, no trip without one

The rest assert that each policy lever actually moves the number it claims to.
A lever that changes nothing is worse than a missing lever — it invites a
planner to act on noise.
"""

from __future__ import annotations

import pytest

from app.sim.engine import Simulation
from app.sim.metrics import compare, summarise, timeline
from app.sim.scenario import FleetMix, PolicyLevers, ScenarioSpec, WeatherSpec, ZoneSpec


def spec(**overrides) -> ScenarioSpec:
    """A small but non-trivial city: four zones, mixed density.

    The window is the 07:00–13:00 morning peak, not midnight–06:00. Six hours
    starting at midnight covers the four quietest hours of the day and generates
    single-digit demand, which makes every comparison below a coin flip.
    """
    base = dict(
        seed=7,
        simHours=6.0,
        startHour=7.0,
        zones=[
            ZoneSpec(zoneId="1", name="Camp", lat=15.8560, lng=74.5060, populationIx=9.0,
                     congestionIndex=0.45),
            ZoneSpec(zoneId="2", name="Tilakwadi", lat=15.8430, lng=74.4980, populationIx=7.0,
                     congestionIndex=0.30),
            ZoneSpec(zoneId="3", name="Shahapur", lat=15.8380, lng=74.5120, populationIx=6.0,
                     congestionIndex=0.25),
            ZoneSpec(zoneId="4", name="Vadgaon", lat=15.8290, lng=74.4870, populationIx=4.0,
                     congestionIndex=0.15),
        ],
        fleet=FleetMix(scooter=40, ebike=20, bike=10),
    )
    base.update(overrides)
    return ScenarioSpec(**base)


def run(s: ScenarioSpec) -> dict:
    sim = Simulation(s)
    state = sim.run()
    return summarise(s, state, sim.fleet)


# ---- the two mandated tests -------------------------------------------------


def test_same_seed_gives_identical_metrics():
    """design.md §5: determinism. Same seed + same scenario = same metrics."""
    a = run(spec(seed=1234))
    b = run(spec(seed=1234))
    assert a == b


def test_different_seed_changes_the_outcome():
    """Determinism must not be achieved by ignoring the seed."""
    a = run(spec(seed=1))
    b = run(spec(seed=999))
    assert a != b


def test_conservation_of_vehicles():
    """No vehicle in two zones; every vehicle released; no phantom trips."""
    s = spec()
    sim = Simulation(s)
    state = sim.run()

    # Exactly one zone bucket holds each vehicle.
    placements = [(v.vehicleId, zid) for zid, bucket in sim._by_zone.items() for v in bucket]
    ids = [vid for vid, _ in placements]
    assert len(ids) == len(sim.fleet)
    assert len(set(ids)) == len(ids), "a vehicle appears in more than one zone"

    # A vehicle's recorded zone agrees with the bucket it sits in.
    for vid, zid in placements:
        assert sim.vehicles[vid].zoneId == zid

    # Nothing is still claimed once the clock stops.
    assert all(v.riderId is None for v in sim.fleet)

    # Every trip names a real vehicle, and per-vehicle trip counts reconcile.
    assert all(t.vehicleId in sim.vehicles for t in state.trips)
    assert sum(v.trips for v in sim.fleet) == len(state.trips)

    # Every rider is served exactly once or unserved exactly once, never both.
    served = {t.riderId for t in state.trips}
    unserved = {a.riderId for a in state.unserved}
    assert not (served & unserved)
    assert len(served) + len(unserved) == len(sim.arrivals)


# ---- levers move numbers ----------------------------------------------------


def test_closed_zone_removes_its_demand():
    open_city = run(spec())
    closed = run(spec(policy=PolicyLevers(closedZones=["1"])))
    # Camp is the densest zone; closing it must cut total demand.
    assert closed["demandTotal"] < open_city["demandTotal"]


def test_rain_suppresses_demand():
    dry = run(spec(weather=WeatherSpec(precipitationMm=0.0)))
    wet = run(spec(weather=WeatherSpec(precipitationMm=8.0)))
    assert wet["demandTotal"] < dry["demandTotal"]


def test_bike_lanes_reduce_incident_rate():
    """Protected infrastructure is the lever safety policy actually has."""
    plain = run(spec(seed=3, fleet=FleetMix(scooter=200, ebike=100, bike=60)))
    laned = run(
        spec(
            seed=3,
            fleet=FleetMix(scooter=200, ebike=100, bike=60),
            policy=PolicyLevers(bikeLaneZones=["1", "2", "3", "4"]),
        )
    )
    assert laned["incidentsPer1000Km"] < plain["incidentsPer1000Km"]


def test_bigger_fleet_serves_more_of_the_same_demand():
    small = run(spec(fleet=FleetMix(scooter=5, ebike=0, bike=0)))
    large = run(spec(fleet=FleetMix(scooter=300, ebike=100, bike=50)))
    assert large["serviceRatePct"] > small["serviceRatePct"]
    assert small["tripsUnserved"] > large["tripsUnserved"]


def test_starved_fleet_reports_why_demand_went_unmet():
    starved = run(spec(fleet=FleetMix(scooter=2, ebike=0, bike=0)))
    assert starved["tripsUnserved"] > 0
    assert sum(starved["unservedReasons"].values()) == starved["tripsUnserved"]


def test_rebalancing_moves_vehicles_and_costs_empty_distance():
    off = run(spec(seed=5))
    on = run(spec(seed=5, policy=PolicyLevers(rebalanceEnabled=True, rebalanceIntervalMin=30)))
    assert off["rebalanceMoves"] == 0
    assert on["rebalanceMoves"] > 0
    # Rebalancing is never free — the empty kilometres are the cost of it.
    assert on["distanceEmptyKm"] > off["distanceEmptyKm"]


# ---- metric integrity -------------------------------------------------------


def test_metrics_reconcile():
    s = spec()
    sim = Simulation(s)
    state = sim.run()
    m = summarise(s, state, sim.fleet)

    assert m["demandTotal"] == m["tripsServed"] + m["tripsUnserved"]
    assert m["fleetSize"] == s.fleet.total()
    assert 0.0 <= m["vehicleUtilizationPct"] <= 100.0
    assert 0.0 <= m["serviceRatePct"] <= 100.0
    assert m["safetyIncidents"] <= m["tripsServed"]
    assert m["co2AvoidedKg"] >= 0.0


def test_timeline_sums_to_the_totals():
    s = spec()
    sim = Simulation(s)
    state = sim.run()
    m = summarise(s, state, sim.fleet)
    rows = timeline(s, state)

    assert sum(r["tripsServed"] for r in rows) == m["tripsServed"]
    assert sum(r["tripsUnserved"] for r in rows) == m["tripsUnserved"]


def test_progress_is_monotonic_and_reaches_one():
    seen: list[float] = []
    sim = Simulation(spec(), progress=lambda pct, _p: seen.append(pct))
    sim.run()

    assert seen, "no progress was reported"
    assert seen == sorted(seen)
    assert seen[-1] == pytest.approx(1.0)


def test_empty_fleet_serves_nobody_without_crashing():
    m = run(spec(fleet=FleetMix(scooter=0, ebike=0, bike=0)))
    assert m["tripsServed"] == 0
    assert m["tripsUnserved"] > 0
    assert m["vehicleUtilizationPct"] == 0.0


# ---- comparison -------------------------------------------------------------


def test_compare_labels_direction_by_metric_not_by_sign():
    baseline = run(spec(seed=11, fleet=FleetMix(scooter=8, ebike=0, bike=0)))
    variant = run(spec(seed=11, fleet=FleetMix(scooter=250, ebike=80, bike=40)))
    rows = {r["metric"]: r for r in compare(baseline, variant)}

    # More trips served is better; fewer unserved is also better. Opposite
    # signs, same verdict — which is the whole point of the direction field.
    assert rows["tripsServed"]["delta"] > 0
    assert rows["tripsServed"]["direction"] == "better"
    assert rows["tripsUnserved"]["delta"] < 0
    assert rows["tripsUnserved"]["direction"] == "better"


def test_compare_of_a_run_with_itself_is_all_zero():
    m = run(spec())
    rows = compare(m, m)
    assert rows
    assert all(r["delta"] == 0 and r["direction"] == "same" for r in rows)
