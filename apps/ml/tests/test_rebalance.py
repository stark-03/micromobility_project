"""M07 rebalancing optimiser.

The properties asserted here are the ones that make a plan trustworthy: it
never invents vehicles, never exceeds what the crews can carry, prefers the
cheap move, and declines a move that does not pay for itself. A solver that
returns a plausible-looking plan while breaking any of these is worse than no
solver, because the plan gets executed.
"""

from __future__ import annotations

from app.fleet.rebalance import ZoneState, haversine_km, plan_charging, solve_rebalance


def zones(*spec: tuple[str, float, float, int, float]) -> list[ZoneState]:
    return [
        ZoneState(zoneId=z, name=f"Zone {z}", lat=lat, lng=lng, supply=s, demand=d)
        for z, lat, lng, s, d in spec
    ]


CITY = zones(
    ("1", 15.8560, 74.5060, 20, 6.0),   # big surplus
    ("2", 15.8430, 74.4980, 2, 12.0),   # short, and near zone 1
    ("3", 15.8380, 74.5120, 3, 10.0),   # short
    ("4", 15.8290, 74.4870, 14, 4.0),   # surplus, further out
)


def test_moves_only_from_surplus_to_deficit():
    plan = solve_rebalance(CITY, van_count=2, van_capacity=8)
    surplus = {"1", "4"}
    deficit = {"2", "3"}
    assert plan.moves
    for m in plan.moves:
        assert m.fromZoneId in surplus
        assert m.toZoneId in deficit


def test_never_moves_more_than_a_zone_can_spare():
    plan = solve_rebalance(CITY, van_count=8, van_capacity=8)
    out: dict[str, int] = {}
    for m in plan.moves:
        out[m.fromZoneId] = out.get(m.fromZoneId, 0) + m.vehicles

    by_id = {z.zoneId: z for z in CITY}
    for zone_id, moved in out.items():
        assert moved <= by_id[zone_id].gap, f"zone {zone_id} sent vehicles it did not have"


def test_never_overfills_a_short_zone():
    plan = solve_rebalance(CITY, van_count=8, van_capacity=8)
    incoming: dict[str, int] = {}
    for m in plan.moves:
        incoming[m.toZoneId] = incoming.get(m.toZoneId, 0) + m.vehicles

    by_id = {z.zoneId: z for z in CITY}
    for zone_id, got in incoming.items():
        # Ceil, because a deficit of 9.2 is honestly filled by 10 vehicles.
        assert got <= -by_id[zone_id].gap + 1


def test_respects_van_capacity():
    plan = solve_rebalance(CITY, van_count=1, van_capacity=5)
    assert plan.totalVehicles <= 5
    assert any("binding constraint" in n for n in plan.notes)


def test_more_vans_close_more_of_the_gap():
    small = solve_rebalance(CITY, van_count=1, van_capacity=4)
    large = solve_rebalance(CITY, van_count=4, van_capacity=8)
    assert large.deficitAfter < small.deficitAfter
    assert large.totalVehicles > small.totalVehicles


def test_returns_whole_vehicles():
    """Total unimodularity, not rounding. Half a scooter cannot be dispatched."""
    plan = solve_rebalance(CITY, van_count=3, van_capacity=7)
    for m in plan.moves:
        assert isinstance(m.vehicles, int)
        assert m.vehicles >= 1


def test_prefers_the_nearer_surplus_zone():
    """Two identical surpluses, one close and one far: the close one goes."""
    near_and_far = zones(
        ("near", 15.8440, 74.4990, 10, 0.0),
        ("far", 16.2000, 74.9000, 10, 0.0),
        ("short", 15.8430, 74.4980, 0, 8.0),
    )
    plan = solve_rebalance(near_and_far, van_count=1, van_capacity=8, value_per_vehicle_km=60.0)
    sent = {m.fromZoneId: m.vehicles for m in plan.moves}
    assert sent.get("near", 0) == 8
    assert "far" not in sent


def test_declines_a_move_that_does_not_pay_for_itself():
    """The value dial is the point: a 40 km haul for one vehicle is not work."""
    far_apart = zones(
        ("a", 15.8000, 74.5000, 10, 0.0),
        ("b", 16.2000, 74.9000, 0, 5.0),
    )
    cheap = solve_rebalance(far_apart, value_per_vehicle_km=2.0)
    generous = solve_rebalance(far_apart, value_per_vehicle_km=100.0)

    assert cheap.totalVehicles == 0
    assert cheap.status == "no_action"
    assert any("pays for itself" in n for n in cheap.notes)
    assert generous.totalVehicles > 0


def test_balanced_city_needs_no_plan():
    balanced = zones(("1", 15.85, 74.50, 5, 5.0), ("2", 15.84, 74.49, 5, 5.0))
    plan = solve_rebalance(balanced)
    assert plan.status == "no_action"
    assert plan.moves == []
    assert plan.deficitAfter == plan.deficitBefore


def test_no_surplus_anywhere_is_reported_not_crashed():
    starved = zones(("1", 15.85, 74.50, 0, 9.0), ("2", 15.84, 74.49, 1, 8.0))
    plan = solve_rebalance(starved)
    assert plan.status == "no_action"
    assert any("spare vehicles" in n for n in plan.notes)


def test_zero_vans_is_handled():
    plan = solve_rebalance(CITY, van_count=0)
    assert plan.totalVehicles == 0
    assert any("van capacity" in n for n in plan.notes)


def test_deficit_after_never_exceeds_deficit_before():
    for vans in (0, 1, 2, 5, 20):
        plan = solve_rebalance(CITY, van_count=vans, van_capacity=8)
        assert plan.deficitAfter <= plan.deficitBefore
        assert plan.deficitAfter >= 0


def test_haversine_matches_a_known_distance():
    # Belagavi centre to Vadgaon, ~2.5 km on the ground.
    d = haversine_km((15.8497, 74.4977), (15.8290, 74.4870))
    assert 2.0 < d < 3.0


# ---- charging ---------------------------------------------------------------


def test_charging_picks_the_flattest_first():
    vehicles = [
        {"vehicleId": "A", "zoneId": "1", "batteryPct": 25},
        {"vehicleId": "B", "zoneId": "1", "batteryPct": 5},
        {"vehicleId": "C", "zoneId": "1", "batteryPct": 15},
    ]
    picks = plan_charging(vehicles, CITY, crew_capacity=3)
    assert [p.vehicleId for p in picks] == ["B", "C", "A"]


def test_charging_leaves_a_starved_zone_alone_where_it_can():
    """Same battery, different zones: collect from the zone that can spare it."""
    vehicles = [
        {"vehicleId": "rich", "zoneId": "1", "batteryPct": 10},   # zone 1 has surplus
        {"vehicleId": "poor", "zoneId": "2", "batteryPct": 10},   # zone 2 is short
    ]
    picks = plan_charging(vehicles, CITY, crew_capacity=2)
    assert picks[0].vehicleId == "rich"


def test_charging_ignores_healthy_batteries():
    vehicles = [{"vehicleId": "A", "zoneId": "1", "batteryPct": 90}]
    assert plan_charging(vehicles, CITY) == []


def test_charging_respects_crew_capacity():
    vehicles = [{"vehicleId": str(i), "zoneId": "1", "batteryPct": i} for i in range(1, 25)]
    assert len(plan_charging(vehicles, CITY, crew_capacity=6)) == 6


# ---- HTTP surface -----------------------------------------------------------

from fastapi.testclient import TestClient  # noqa: E402

from app.config import ML_INTERNAL_SECRET  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)
AUTH = {"X-Internal-Secret": ML_INTERNAL_SECRET}

BODY = {
    "zones": [
        {"zoneId": "1", "name": "Camp", "lat": 15.856, "lng": 74.506, "supply": 20, "demand": 6},
        {"zoneId": "2", "name": "Tilak", "lat": 15.843, "lng": 74.498, "supply": 2, "demand": 12},
    ],
    "vanCount": 2,
    "vanCapacity": 8,
}


def test_rebalance_endpoint_requires_the_secret():
    """A *valid* body without the header must 401.

    Asserted with a valid body on purpose: pydantic runs before the handler, so
    an invalid body returns 422 and would pass this test without the header
    check ever executing.
    """
    assert client.post("/internal/fleet/rebalance", json=BODY).status_code == 401


def test_rebalance_endpoint_returns_a_plan():
    res = client.post("/internal/fleet/rebalance", json=BODY, headers=AUTH)
    assert res.status_code == 200
    plan = res.json()

    assert plan["status"] == "planned"
    assert plan["moves"]
    assert plan["deficitAfter"] <= plan["deficitBefore"]
    move = plan["moves"][0]
    assert move["fromZoneId"] == "1" and move["toZoneId"] == "2"
    # Must survive JSON encoding as plain numbers, not numpy scalars.
    assert isinstance(move["vehicles"], int)
    assert isinstance(move["distanceKm"], float)


def test_charging_endpoint_ranks_candidates():
    res = client.post(
        "/internal/fleet/charging",
        json={
            "zones": BODY["zones"],
            "vehicles": [
                {"vehicleId": "A", "zoneId": "1", "batteryPct": 22},
                {"vehicleId": "B", "zoneId": "1", "batteryPct": 4},
            ],
            "crewCapacity": 5,
        },
        headers=AUTH,
    )
    assert res.status_code == 200
    assert [c["vehicleId"] for c in res.json()["candidates"]] == ["B", "A"]


def test_rebalance_rejects_an_empty_city():
    res = client.post("/internal/fleet/rebalance", json={"zones": []}, headers=AUTH)
    assert res.status_code == 422
