"""Scenario specification — every policy lever a planner can pull.

design.md §1: "Every policy lever a planner can pull in the real city must be
expressible as a scenario parameter and comparable against a baseline run."
That makes this module the contract for the whole feature: if a lever is not
here, it cannot be simulated, and if it is here it must reach the engine.

The service holds no database credentials (design.md §2), so the caller sends
the world it wants simulated. Express assembles this payload from MySQL.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

# Grams of CO2 per passenger-kilometre. The counterfactual is the trip the rider
# would otherwise have taken by car — that is the number a planner reports.
CO2_G_PER_KM_CAR = 120.0
CO2_G_PER_KM: dict[str, float] = {
    # Grid electricity, amortised over the vehicle's service life.
    "scooter": 22.0,
    "ebike": 18.0,
    "bike": 0.0,
}

# Cruising speed on flat ground, free of traffic.
SPEED_KPH: dict[str, float] = {"scooter": 20.0, "ebike": 22.0, "bike": 15.0}

# Percent of battery consumed per kilometre. A pedal bike never depletes.
BATTERY_PCT_PER_KM: dict[str, float] = {"scooter": 3.2, "ebike": 2.1, "bike": 0.0}

# Below this, a vehicle is not offered to a rider — it would strand them.
MIN_USABLE_BATTERY_PCT = 15.0

# Riders walk to a vehicle rather than teleport. Beyond this they give up and
# the trip is recorded unserved, which is the metric operators actually chase.
WALK_SPEED_KPH = 4.8
MAX_WALK_M = 500.0


class ZoneSpec(BaseModel):
    """One zone of the city. Travel is modelled centroid to centroid."""

    zoneId: str
    name: str = ""
    lat: float
    lng: float
    populationIx: float = 6.0
    # 0 = free flowing, 1 = gridlock. Replayed from a real day or forecast.
    congestionIndex: float = 0.2


class FleetMix(BaseModel):
    """How many of each vehicle type start the day on the street."""

    scooter: int = Field(default=120, ge=0, le=5000)
    ebike: int = Field(default=60, ge=0, le=5000)
    bike: int = Field(default=40, ge=0, le=5000)

    def total(self) -> int:
        return self.scooter + self.ebike + self.bike


class WeatherSpec(BaseModel):
    precipitationMm: float = Field(default=0.0, ge=0.0, le=200.0)
    tempC: float = Field(default=27.0, ge=-20.0, le=60.0)


class PolicyLevers(BaseModel):
    """The levers. Each one must change a number the planner can see."""

    # Zones given protected bike infrastructure: safer, and slightly faster
    # because riders stop weaving through traffic.
    bikeLaneZones: list[str] = Field(default_factory=list)
    # Zones closed to micro-mobility entirely — demand there goes unserved.
    closedZones: list[str] = Field(default_factory=list)
    # Multiplies the whole demand profile. Price rises, ridership falls.
    demandMultiplier: float = Field(default=1.0, ge=0.0, le=5.0)
    # Rebalancing vans move idle vehicles from surplus to deficit zones.
    rebalanceEnabled: bool = False
    rebalanceIntervalMin: int = Field(default=60, ge=5, le=720)
    rebalanceVanCapacity: int = Field(default=8, ge=1, le=50)


class ScenarioSpec(BaseModel):
    """A complete, self-contained description of one simulated day."""

    seed: int = Field(default=42, ge=0, le=2**31 - 1)
    simHours: float = Field(default=24.0, gt=0.0, le=168.0)
    # Wall-clock hour the run starts at. A 6-hour run beginning at midnight
    # covers the four quietest hours of the day and tells a planner nothing;
    # starting at 07:00 covers the morning peak. Default 0 = a full day.
    startHour: float = Field(default=0.0, ge=0.0, lt=24.0)
    # design.md §5 specifies a 1-second clock. Anything coarser than 60 s starts
    # to distort queueing at busy zones, so that is the ceiling.
    stepSeconds: int = Field(default=1, ge=1, le=60)

    zones: list[ZoneSpec] = Field(..., min_length=1)
    fleet: FleetMix = Field(default_factory=FleetMix)
    weather: WeatherSpec = Field(default_factory=WeatherSpec)
    policy: PolicyLevers = Field(default_factory=PolicyLevers)

    # trips per zone per hour, keyed by zoneId, 24 values starting at midnight.
    # Absent zones fall back to a population-scaled default curve.
    demand: dict[str, list[float]] = Field(default_factory=dict)


# Daily trips generated per unit of a zone's population index. Calibrated so a
# mid-size Belagavi deployment produces a few thousand trips a day — the scale
# an operator running a few hundred vehicles would actually see.
DAILY_TRIPS_PER_POP_UNIT = 40.0

# A twin-peaked commute shape, normalised to sum to 1.0. Multiplied by a zone's
# population index to get trips per hour.
DEFAULT_HOURLY_SHAPE: list[float] = [
    0.004, 0.002, 0.001, 0.001, 0.003, 0.012, 0.032, 0.071,
    0.098, 0.074, 0.048, 0.041, 0.045, 0.043, 0.041, 0.048,
    0.069, 0.101, 0.108, 0.079, 0.048, 0.028, 0.016, 0.008,
]


def hourly_demand(spec: ScenarioSpec, zone: ZoneSpec) -> list[float]:
    """Trips per hour for one zone, after policy is applied.

    An explicit profile always wins; otherwise the default commute shape is
    scaled by population so a dense zone generates more trips than a sparse one.
    """
    given = spec.demand.get(zone.zoneId)
    if given and len(given) == 24:
        base = list(given)
    else:
        daily = zone.populationIx * DAILY_TRIPS_PER_POP_UNIT
        base = [daily * s for s in DEFAULT_HOURLY_SHAPE]

    multiplier = spec.policy.demandMultiplier

    # Rain suppresses micro-mobility demand hard; this is the single largest
    # weather effect in the literature and riders feel it immediately.
    rain = spec.weather.precipitationMm
    if rain > 0:
        multiplier *= max(0.25, 1.0 - 0.06 * rain)

    return [v * multiplier for v in base]
