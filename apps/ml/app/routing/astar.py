"""A* over the road graph."""

import networkx as nx

from .costs import Profile, congestion_delay_seconds, free_flow_seconds
from .graph import build_graph, haversine_m, heuristic, nearest_node, routable_nodes


class NoRouteError(Exception):
    """Raised when origin and destination are not connected."""


# Farthest a pin may be moved to reach the routable network. Snapping is meant
# to cover the gap between a doorstep and the street; past this, the point is
# genuinely off the network and saying so beats routing somewhere else.
MAX_SNAP_M = 750.0


def plan_route(
    edges: list[dict],
    origin: tuple[float, float],
    destination: tuple[float, float],
    profile: Profile,
    mode: str,
) -> dict:
    """Plan one route and return geometry, ETA, distance, energy and risk."""
    g = build_graph(edges, profile, mode)
    if g.number_of_nodes() == 0:
        raise NoRouteError("The road network is empty for this mode")

    # Snap both ends into the same strongly connected network, so a route
    # between them always exists. The snap distance is reported back, so a
    # rider whose pin moved is told how far.
    network = routable_nodes(g)
    start = nearest_node(g, origin, network)
    goal = nearest_node(g, destination, network)
    if start is None or goal is None:
        raise NoRouteError("Could not snap origin or destination onto the network")
    for label, node, point in (("Pickup", start, origin), ("Destination", goal, destination)):
        if haversine_m(tuple(g.nodes[node]["pos"]), point) > MAX_SNAP_M:
            raise NoRouteError(
                f"{label} is more than {MAX_SNAP_M:.0f} m from any road the router can use"
            )
    if start == goal:
        raise NoRouteError("Origin and destination snap to the same junction")

    max_speed = max((d["speedFreeKph"] for _, _, d in g.edges(data=True)), default=50.0)

    try:
        path = nx.astar_path(g, start, goal, heuristic=heuristic(g, goal, max_speed), weight="cost")
    except nx.NetworkXNoPath as exc:
        raise NoRouteError("No route exists between those points") from exc

    geometry: list[list[float]] = []
    steps: list[dict] = []
    distance_m = 0.0
    duration_s = 0.0
    climb_m = 0.0
    congestion_weighted = 0.0

    for a, b in zip(path, path[1:], strict=False):
        e = g[a][b]
        coords = e.get("geometry") or []
        # Skip the shared junction so the line has no duplicated vertex.
        geometry.extend(coords if not geometry else coords[1:])

        seg_free = free_flow_seconds(e["lengthM"], e["speedFreeKph"])
        seg_delay = congestion_delay_seconds(e["lengthM"], e["speedFreeKph"], e["congestionIndex"])
        seg_time = seg_free + seg_delay

        distance_m += e["lengthM"]
        duration_s += seg_time
        climb_m += max(e["gradientPct"], 0.0) / 100.0 * e["lengthM"]
        congestion_weighted += e["congestionIndex"] * e["lengthM"]

        steps.append(
            {
                "segmentId": e["segmentId"],
                "name": e["name"],
                "roadClass": e["roadClass"],
                "lengthM": round(e["lengthM"], 2),
                "durationS": round(seg_time, 1),
                "congestionIndex": round(e["congestionIndex"], 3),
            }
        )

    mean_congestion = congestion_weighted / distance_m if distance_m > 0 else 0.0

    # Energy: a flat cost per km by mode plus the work of climbing. Deliberately
    # simple and cited rather than fitted — M10 owns the real model.
    wh_per_km = {"scooter": 22.0, "ebike": 12.0, "ev": 140.0, "bike": 0.0}.get(mode, 20.0)
    energy_wh = wh_per_km * distance_m / 1000.0 + climb_m * 0.6

    return {
        "profile": profile.name,
        "mode": mode,
        "geometry": {"type": "LineString", "coordinates": geometry},
        "distanceM": round(distance_m, 2),
        "durationS": round(duration_s, 1),
        "etaMinutes": round(duration_s / 60.0, 1),
        "elevationGainM": round(climb_m, 1),
        "energyWh": round(energy_wh, 1),
        # 0-100, higher is riskier. Congestion is the only risk input until M09
        # supplies real segment safety scores.
        "riskScore": round(min(100.0, mean_congestion * 100.0), 1),
        "meanCongestion": round(mean_congestion, 3),
        "steps": steps,
        "nodeCount": len(path),
        "snappedOrigin": g.nodes[start].get("pos"),
        "snappedDestination": g.nodes[goal].get("pos"),
        "snapDistanceM": round(
            haversine_m(tuple(g.nodes[start]["pos"]), origin)
            + haversine_m(tuple(g.nodes[goal]["pos"]), destination),
            1,
        ),
    }
