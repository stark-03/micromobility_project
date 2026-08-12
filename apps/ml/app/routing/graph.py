"""Builds a NetworkX graph from the payload Express sends.

The service has no database access, so the whole subgraph arrives per request
(design.md §2). At city scale that is ~150 edges — cheap to send and cheap to
rebuild, and it keeps the service stateless.
"""

import math

import networkx as nx

from .costs import MODE_FORBIDDEN, Profile, edge_cost

R_EARTH_M = 6_371_000.0


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance in metres between two [lng, lat] points."""
    lng1, lat1 = a
    lng2, lat2 = b
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lng / 2) ** 2
    )
    return 2 * R_EARTH_M * math.asin(math.sqrt(h))


def build_graph(edges: list[dict], profile: Profile, mode: str) -> nx.DiGraph:
    """Directed graph with one arc per permitted direction of travel.

    Directed, not undirected, because one-way streets are real and a router that
    ignores them sends riders the wrong way up an arterial.
    """
    g = nx.DiGraph()
    forbidden = MODE_FORBIDDEN.get(mode, set())

    for e in edges:
        if e.get("roadClass") in forbidden:
            continue

        a = e["fromNode"]
        b = e["toNode"]
        cost = edge_cost(e, profile)
        coords = e.get("geometry", [])

        for node, point in ((a, coords[0] if coords else None), (b, coords[-1] if coords else None)):
            if node not in g:
                g.add_node(node, pos=point)
            elif g.nodes[node].get("pos") is None and point is not None:
                g.nodes[node]["pos"] = point

        attrs = {
            "cost": cost,
            "segmentId": str(e.get("segmentId", "")),
            "name": e.get("name"),
            "lengthM": float(e.get("lengthM", 0.0)),
            "speedFreeKph": float(e.get("speedFreeKph", 0.0)),
            "congestionIndex": float(e.get("congestionIndex", 0.0)),
            "gradientPct": float(e.get("gradientPct", 0.0)),
            "roadClass": e.get("roadClass"),
            "geometry": coords,
        }

        # Keep the cheaper arc when a pair of nodes is joined more than once.
        if not g.has_edge(a, b) or g[a][b]["cost"] > cost:
            g.add_edge(a, b, **attrs)
        if not e.get("oneWay", False):
            reversed_attrs = dict(attrs)
            reversed_attrs["geometry"] = list(reversed(coords))
            if not g.has_edge(b, a) or g[b][a]["cost"] > cost:
                g.add_edge(b, a, **reversed_attrs)

    return g


def nearest_node(g: nx.DiGraph, point: tuple[float, float]) -> str | None:
    """Graph node closest to an arbitrary coordinate.

    Riders do not start at junctions, so origin and destination are snapped onto
    the network before the search begins.
    """
    best: str | None = None
    best_d = float("inf")
    for node, data in g.nodes(data=True):
        pos = data.get("pos")
        if pos is None:
            continue
        d = haversine_m((pos[0], pos[1]), point)
        if d < best_d:
            best_d = d
            best = node
    return best


def heuristic(g: nx.DiGraph, goal: str, max_speed_kph: float):
    """Admissible A* heuristic: straight-line time at the fastest legal speed.

    It must never overestimate, or A* stops being optimal. Dividing by the
    highest speed on the network guarantees that.
    """
    goal_pos = g.nodes[goal].get("pos")
    speed_ms = max(max_speed_kph, 1.0) * 1000.0 / 3600.0

    def h(node: str, _goal: str = goal) -> float:
        pos = g.nodes[node].get("pos")
        if pos is None or goal_pos is None:
            return 0.0
        return haversine_m((pos[0], pos[1]), (goal_pos[0], goal_pos[1])) / speed_ms

    return h
