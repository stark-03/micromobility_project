"""Routing tests. Run with: pytest"""

import math

import pytest

from app.routing.astar import NoRouteError, plan_route
from app.routing.costs import PROFILES, congestion_delay_seconds, edge_cost, free_flow_seconds
from app.routing.graph import build_graph, haversine_m, nearest_node


def edge(seg_id, a, b, coords, length=500.0, speed=40.0, congestion=0.0, **kw):
    return {
        "segmentId": seg_id,
        "fromNode": a,
        "toNode": b,
        "lengthM": length,
        "speedFreeKph": speed,
        "congestionIndex": congestion,
        "gradientPct": kw.get("gradientPct", 0.0),
        "roadClass": kw.get("roadClass", "local"),
        "oneWay": kw.get("oneWay", False),
        "name": kw.get("name", f"Road {seg_id}"),
        "safetyScore": kw.get("safetyScore", 70.0),
        "geometry": coords,
    }


# A diamond: two ways from A to D. The north route is longer but clear, the
# south route is shorter but can be congested.
def diamond(south_congestion=0.0):
    return [
        edge("1", "A", "B", [[74.50, 15.85], [74.505, 15.855]], length=700),
        edge("2", "B", "D", [[74.505, 15.855], [74.51, 15.85]], length=700),
        edge("3", "A", "C", [[74.50, 15.85], [74.505, 15.845]], length=500, congestion=south_congestion),
        edge("4", "C", "D", [[74.505, 15.845], [74.51, 15.85]], length=500, congestion=south_congestion),
    ]


class TestCosts:
    def test_free_flow_seconds(self):
        # 1000 m at 36 kph = 10 m/s = 100 s
        assert free_flow_seconds(1000, 36) == pytest.approx(100.0)

    def test_congestion_adds_delay(self):
        clear = congestion_delay_seconds(1000, 36, 0.0)
        heavy = congestion_delay_seconds(1000, 36, 0.75)
        assert clear == pytest.approx(0.0)
        assert heavy > 0
        # At 75% congestion speed is a quarter, so time quadruples: +300 s.
        assert heavy == pytest.approx(300.0, rel=0.01)

    def test_jammed_road_is_expensive_but_finite(self):
        # An infinite cost would make the router refuse to plan at all.
        assert math.isfinite(congestion_delay_seconds(1000, 36, 1.0))

    def test_profiles_weight_differently(self):
        risky = edge("x", "A", "B", [], congestion=0.6, safetyScore=20.0)
        assert edge_cost(risky, PROFILES["safest"]) > edge_cost(risky, PROFILES["fastest"])

    def test_greenest_penalises_climbing_hardest(self):
        hill = edge("x", "A", "B", [], gradientPct=8.0)
        assert edge_cost(hill, PROFILES["greenest"]) > edge_cost(hill, PROFILES["fastest"])

    def test_all_three_profiles_from_design_doc(self):
        assert set(PROFILES) == {"fastest", "safest", "greenest"}
        assert PROFILES["fastest"].w_safety == 0.1
        assert PROFILES["greenest"].w_gradient == 0.9


class TestGraph:
    def test_two_way_edges_are_traversable_both_ways(self):
        g = build_graph(diamond(), PROFILES["fastest"], "scooter")
        assert g.has_edge("A", "B") and g.has_edge("B", "A")

    def test_one_way_is_respected(self):
        edges = [edge("1", "A", "B", [[74.5, 15.85], [74.51, 15.85]], oneWay=True)]
        g = build_graph(edges, PROFILES["fastest"], "scooter")
        assert g.has_edge("A", "B")
        assert not g.has_edge("B", "A")

    def test_mode_restrictions_remove_edges(self):
        edges = [edge("1", "A", "B", [[74.5, 15.85], [74.51, 15.85]], roadClass="path")]
        # An EV has no business on a footpath.
        assert build_graph(edges, PROFILES["fastest"], "ev").number_of_edges() == 0
        assert build_graph(edges, PROFILES["fastest"], "bike").number_of_edges() > 0

    def test_nearest_node_snaps_to_the_closest_junction(self):
        g = build_graph(diamond(), PROFILES["fastest"], "scooter")
        assert nearest_node(g, (74.5001, 15.8501)) == "A"

    def test_haversine_is_metres(self):
        # ~0.01 deg of latitude is ~1.1 km
        d = haversine_m((74.5, 15.85), (74.5, 15.86))
        assert 1050 < d < 1150


class TestPlanRoute:
    def test_finds_a_route_and_reports_its_shape(self):
        r = plan_route(diamond(), (74.50, 15.85), (74.51, 15.85), PROFILES["fastest"], "scooter")
        assert r["distanceM"] > 0
        assert r["durationS"] > 0
        assert r["geometry"]["type"] == "LineString"
        assert len(r["geometry"]["coordinates"]) >= 3
        assert len(r["steps"]) >= 2

    def test_prefers_the_short_way_when_it_is_clear(self):
        r = plan_route(diamond(0.0), (74.50, 15.85), (74.51, 15.85), PROFILES["fastest"], "scooter")
        assert [s["segmentId"] for s in r["steps"]] == ["3", "4"]

    def test_avoids_the_short_way_when_it_is_jammed(self):
        # This is the whole point of a congestion-aware router.
        r = plan_route(diamond(0.9), (74.50, 15.85), (74.51, 15.85), PROFILES["fastest"], "scooter")
        assert [s["segmentId"] for s in r["steps"]] == ["1", "2"]

    def test_geometry_has_no_duplicated_junction(self):
        r = plan_route(diamond(), (74.50, 15.85), (74.51, 15.85), PROFILES["fastest"], "scooter")
        coords = r["geometry"]["coordinates"]
        for a, b in zip(coords, coords[1:], strict=False):
            assert a != b

    def test_reports_energy_and_risk(self):
        r = plan_route(diamond(0.5), (74.50, 15.85), (74.51, 15.85), PROFILES["fastest"], "scooter")
        assert r["energyWh"] > 0
        assert 0 <= r["riskScore"] <= 100

    def test_a_bicycle_uses_no_energy(self):
        r = plan_route(diamond(), (74.50, 15.85), (74.51, 15.85), PROFILES["fastest"], "bike")
        assert r["energyWh"] == pytest.approx(0.0, abs=1e-6)

    def test_congestion_makes_the_same_trip_slower(self):
        clear = plan_route(diamond(0.0), (74.50, 15.85), (74.51, 15.85), PROFILES["fastest"], "scooter")
        jammed_edges = [dict(e, congestionIndex=0.8) for e in diamond()]
        jammed = plan_route(jammed_edges, (74.50, 15.85), (74.51, 15.85), PROFILES["fastest"], "scooter")
        assert jammed["durationS"] > clear["durationS"]

    def test_disconnected_graph_raises(self):
        edges = [
            edge("1", "A", "B", [[74.50, 15.85], [74.505, 15.85]]),
            edge("2", "C", "D", [[74.60, 15.95], [74.605, 15.95]]),
        ]
        with pytest.raises(NoRouteError):
            plan_route(edges, (74.50, 15.85), (74.605, 15.95), PROFILES["fastest"], "scooter")

    def test_empty_network_raises(self):
        with pytest.raises(NoRouteError):
            plan_route([], (74.5, 15.85), (74.51, 15.85), PROFILES["fastest"], "scooter")

    def test_astar_matches_dijkstra_on_the_same_graph(self):
        # A* is only worth using if it returns the optimal path. An inadmissible
        # heuristic would silently return something slightly wrong.
        import networkx as nx

        from app.routing.graph import build_graph as bg

        edges = diamond(0.4)
        g = bg(edges, PROFILES["fastest"], "scooter")
        dijkstra = nx.dijkstra_path(g, "A", "D", weight="cost")
        r = plan_route(edges, (74.50, 15.85), (74.51, 15.85), PROFILES["fastest"], "scooter")
        astar_nodes = ["A"] + [s["segmentId"] for s in r["steps"]]
        assert len(astar_nodes) - 1 == len(dijkstra) - 1


class TestSnappingToTheRoutableNetwork:
    """Rani Chennamma Circle, reduced to four edges.

    In the OSM import some junctions can be left but never entered: a one-way
    road leaves them and nothing arrives. Snapping a destination onto one made
    every profile fail with "No route exists", even though a perfectly good
    junction sat a few metres away.
    """

    def network(self):
        return [
            *diamond(),
            # X → D only. X has nowhere to be reached from, and sits right on
            # top of where the rider asked to go.
            edge("5", "X", "D", [[74.5102, 15.8502], [74.51, 15.85]], length=30, oneWay=True),
        ]

    def test_a_destination_beside_an_unreachable_junction_still_routes(self):
        # The point is nearer X than D — the old snap chose X and failed.
        r = plan_route(
            self.network(), (74.50, 15.85), (74.51021, 15.85021), PROFILES["fastest"], "scooter"
        )
        assert r["snappedDestination"] == [74.51, 15.85]
        assert r["distanceM"] > 0

    def test_snapping_reports_how_far_the_pin_moved(self):
        r = plan_route(
            self.network(), (74.50, 15.85), (74.51021, 15.85021), PROFILES["fastest"], "scooter"
        )
        # About 30 m to D, and the report says so rather than hiding it.
        assert 20 < r["snapDistanceM"] < 40

    def test_an_origin_on_an_unreachable_junction_is_moved_too(self):
        # Starting at X would work (X → D exists), but X is outside the network
        # every other junction belongs to, so a rider there could not reach,
        # say, B. Snapping both ends into the same component is what makes any
        # pair of snapped points routable.
        r = plan_route(
            self.network(), (74.5102, 15.8502), (74.505, 15.855), PROFILES["fastest"], "scooter"
        )
        assert r["distanceM"] > 0

    def test_a_point_far_from_the_network_is_refused_not_moved(self):
        # Snapping into the main network must not drag a pin across town.
        with pytest.raises(NoRouteError, match="from any road"):
            plan_route(
                self.network(), (74.50, 15.85), (74.60, 15.95), PROFILES["fastest"], "scooter"
            )
