"""Edge cost function and the three routing profiles.

design.md §4 defines the cost of traversing an edge as

    cost = w_d·(length/speed_free)
         + w_c·congestion_delay
         + w_s·(1 - safety_score/100)
         + w_g·gradient_penalty

and states plainly that the weights live in config, not code — so they are data
here, and a fourth profile is a dict entry rather than a code change.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Profile:
    """Weights for one routing preference."""

    name: str
    w_distance: float
    w_congestion: float
    w_safety: float
    w_gradient: float


# Verbatim from design.md §4.
PROFILES: dict[str, Profile] = {
    "fastest": Profile("fastest", 1.0, 1.0, 0.1, 0.2),
    "safest": Profile("safest", 1.0, 0.6, 1.2, 0.3),
    "greenest": Profile("greenest", 0.8, 0.5, 0.5, 0.9),
}

# A vehicle type may not use every road. A shared EV has no business on a
# footpath, and a cycleway is closed to it.
MODE_FORBIDDEN: dict[str, set[str]] = {
    "scooter": {"path"},
    "bike": set(),
    "ebike": set(),
    "ev": {"path", "cycleway"},
}


def free_flow_seconds(length_m: float, speed_free_kph: float) -> float:
    """Seconds to traverse the edge with no traffic."""
    if speed_free_kph <= 0:
        return float("inf")
    return length_m / (speed_free_kph * 1000.0 / 3600.0)


def congestion_delay_seconds(length_m: float, speed_free_kph: float, congestion: float) -> float:
    """Extra seconds caused by congestion.

    Congestion is 0 (free) to 1 (jammed). Actual speed is modelled as
    speed_free × (1 − congestion), floored so a fully jammed road is slow rather
    than infinitely slow — riders push a scooter rather than wait forever, and an
    infinite cost would make the router refuse to plan at all.
    """
    factor = max(0.08, 1.0 - min(max(congestion, 0.0), 1.0))
    return free_flow_seconds(length_m, speed_free_kph) * (1.0 / factor - 1.0)


# Seconds-equivalent cost of one metre climbed. A rider on a scooter or an
# e-bike loses roughly this much time and effort per metre of ascent.
SECONDS_PER_METRE_CLIMBED = 6.0


def gradient_penalty_seconds(length_m: float, gradient_pct: float) -> float:
    """Seconds-equivalent penalty for climbing.

    Scaled off actual elevation gain, not off the raw percentage. The first
    version multiplied length by percent directly, which charged 350 seconds for
    a 500 m road at 2% — against a 45 s travel time. The gradient term drowned
    out distance and congestion together, and every profile returned the same
    route because nothing else could move the needle.

    Only uphill is penalised; a descent is free but not rewarded, because you
    cannot bank the energy.
    """
    climb_m = length_m * max(gradient_pct, 0.0) / 100.0
    return climb_m * SECONDS_PER_METRE_CLIMBED


def edge_cost(edge: dict, profile: Profile) -> float:
    """Weighted cost of traversing one edge, in seconds-equivalent."""
    length_m = float(edge.get("lengthM", 0.0))
    speed_free = float(edge.get("speedFreeKph", 0.0))
    congestion = float(edge.get("congestionIndex", 0.0))
    safety = float(edge.get("safetyScore", 70.0))
    gradient = float(edge.get("gradientPct", 0.0))

    distance_term = free_flow_seconds(length_m, speed_free)
    congestion_term = congestion_delay_seconds(length_m, speed_free, congestion)
    # safety_score is 0-100; 100 is safest, so the penalty is its complement.
    #
    # Scaled by free-flow time so the penalty is proportional to how long a rider
    # is exposed to the risk — two seconds on a dangerous junction matters less
    # than two minutes on a dangerous arterial.
    safety_term = (1.0 - min(max(safety, 0.0), 100.0) / 100.0) * distance_term
    gradient_term = gradient_penalty_seconds(length_m, gradient)

    return (
        profile.w_distance * distance_term
        + profile.w_congestion * congestion_term
        + profile.w_safety * safety_term
        + profile.w_gradient * gradient_term
    )
