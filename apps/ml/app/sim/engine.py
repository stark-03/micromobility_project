"""The discrete-event simulation loop.

design.md §5 in code:

- **Clock.** SimPy environment over 1-second steps, 24 sim-hours by default.
- **Agents.** Riders spawn from a demand profile, walk to a vehicle, ride, park.
  Vehicles drain battery per km. Rebalance vans move idle stock between zones.
- **Determinism.** One seeded RNG passed down; no module calls `random` directly.

**Why this is mesoscopic, not microscopic.** Riders travel zone-centroid to
zone-centroid at a congestion-adjusted speed rather than turn-by-turn along the
9,212-segment graph. Routing every one of ~30,000 daily riders through A* would
make a 24-hour run take minutes instead of under a second, and it would not
change any metric a planner acts on — wait time, unserved demand and utilisation
are set by *where vehicles are*, not by which street a rider took. The router
(M04) remains the microscopic view; this is the city-scale one. Both read the
same zones and the same congestion index, which is what design.md §1 requires
for a simulated result to be comparable to a measured one.
"""

from __future__ import annotations

import math
import random
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field

import simpy

from .scenario import (
    BATTERY_PCT_PER_KM,
    MAX_WALK_M,
    MIN_USABLE_BATTERY_PCT,
    SPEED_KPH,
    WALK_SPEED_KPH,
    ScenarioSpec,
    ZoneSpec,
    hourly_demand,
)

R_EARTH_M = 6_371_000.0

# Incidents per kilometre ridden in benign conditions. Deliberately small: the
# figure that matters is the *ratio* between scenarios, not the absolute count.
BASE_INCIDENT_RATE_PER_KM = 8e-5


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Metres between two (lat, lng) points."""
    lat1, lng1 = math.radians(a[0]), math.radians(a[1])
    lat2, lng2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlng = lat2 - lat1, lng2 - lng1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * R_EARTH_M * math.asin(math.sqrt(h))


@dataclass
class Vehicle:
    vehicleId: str
    kind: str
    zoneId: str
    batteryPct: float
    # None when idle; the rider id while ridden. The conservation test asserts
    # a vehicle is never claimed by two riders at once.
    riderId: str | None = None
    loadedM: float = 0.0
    emptyM: float = 0.0
    trips: int = 0
    busySeconds: float = 0.0

    @property
    def usable(self) -> bool:
        return self.riderId is None and self.batteryPct >= MIN_USABLE_BATTERY_PCT


@dataclass
class Arrival:
    """A rider's intent to travel, fixed before the clock starts."""

    riderId: str
    at: float
    originZone: str
    destZone: str


@dataclass
class TripRecord:
    riderId: str
    vehicleId: str
    kind: str
    originZone: str
    destZone: str
    startedAt: float
    waitSeconds: float
    rideSeconds: float
    distanceM: float
    # Expected incidents for this trip, not a sampled 0/1. See incident_risk().
    incidentRisk: float


@dataclass
class RunState:
    trips: list[TripRecord] = field(default_factory=list)
    unserved: list[Arrival] = field(default_factory=list)
    # Reason → count, so the Results screen can say *why* demand went unmet.
    unservedReasons: dict[str, int] = field(default_factory=dict)
    rebalanceMoves: int = 0
    rebalanceDistanceM: float = 0.0
    events: list[dict] = field(default_factory=list)


ProgressFn = Callable[[float, dict], None]


def build_arrivals(spec: ScenarioSpec, rng: random.Random) -> list[Arrival]:
    """All rider arrivals for the whole run, generated before the clock starts.

    Pre-generating is what makes a run reproducible in practice rather than in
    principle. If riders were spawned from inside SimPy processes, the order of
    RNG draws would depend on event interleaving, and any future change to a
    process's yield points would silently change results for an unchanged seed.
    Here the seed fixes the arrival list outright.
    """
    zones = [z for z in spec.zones if z.zoneId not in set(spec.policy.closedZones)]
    if not zones:
        return []

    arrivals: list[Arrival] = []
    horizon = spec.simHours * 3600.0
    weights = [max(0.01, z.populationIx) for z in zones]
    counter = 0

    for zone in spec.zones:
        # A closed zone generates no trips at all — that is the lever's effect.
        if zone.zoneId in set(spec.policy.closedZones):
            continue

        curve = hourly_demand(spec, zone)
        for hour in range(int(math.ceil(spec.simHours))):
            # Sim-hour 0 is `startHour` on the clock, so a 6-hour run can cover
            # the morning peak instead of the small hours.
            rate = curve[int(spec.startHour + hour) % 24]
            if rate <= 0:
                continue

            # Poisson arrivals: exponential gaps at the hour's rate. Modelling
            # the count as Poisson and then placing arrivals uniformly would
            # lose the bunching that creates real queues at a busy zone.
            t = hour * 3600.0
            hour_end = min((hour + 1) * 3600.0, horizon)
            while True:
                t += rng.expovariate(rate / 3600.0)
                if t >= hour_end:
                    break

                dest = rng.choices(zones, weights=weights, k=1)[0]
                counter += 1
                arrivals.append(
                    Arrival(
                        riderId=f"R{counter}",
                        at=t,
                        originZone=zone.zoneId,
                        destZone=dest.zoneId,
                    )
                )

    # One clock, one order. Ties broken by rider id so the sort is total and the
    # run does not depend on Python's sort being stable over an unstable input.
    arrivals.sort(key=lambda a: (a.at, a.riderId))
    return arrivals


def build_fleet(spec: ScenarioSpec, rng: random.Random) -> list[Vehicle]:
    """Places the starting fleet across open zones, weighted by population."""
    open_zones = [z for z in spec.zones if z.zoneId not in set(spec.policy.closedZones)]
    if not open_zones:
        return []

    weights = [max(0.01, z.populationIx) for z in open_zones]
    fleet: list[Vehicle] = []
    n = 0

    for kind in ("scooter", "ebike", "bike"):
        for _ in range(getattr(spec.fleet, kind)):
            n += 1
            zone = rng.choices(open_zones, weights=weights, k=1)[0]
            # Bikes have no battery; report them full so utilisation maths and
            # the "unusable" reason code stay uniform across types.
            battery = 100.0 if kind == "bike" else rng.uniform(35.0, 100.0)
            fleet.append(
                Vehicle(vehicleId=f"V{n}", kind=kind, zoneId=zone.zoneId, batteryPct=battery)
            )

    return fleet


def effective_speed_kph(kind: str, zone: ZoneSpec, spec: ScenarioSpec) -> float:
    """Cruising speed after congestion, weather and infrastructure."""
    speed = SPEED_KPH[kind]

    # Congestion costs a rider less than it costs a car — filtering through
    # stopped traffic is most of micro-mobility's time advantage — but it is
    # not free, and it is the channel a bike lane acts on.
    speed *= 1.0 - 0.45 * max(0.0, min(1.0, zone.congestionIndex))

    if zone.zoneId in set(spec.policy.bikeLaneZones):
        speed *= 1.18

    if spec.weather.precipitationMm > 0:
        speed *= max(0.7, 1.0 - 0.02 * spec.weather.precipitationMm)

    return max(4.0, speed)


def incident_risk(distance_m: float, zone: ZoneSpec, spec: ScenarioSpec) -> float:
    """**Expected** incidents for this trip — not a sampled 0/1.

    Injuries are rare enough (order 1 per 10,000 rider-km) that a single 24-hour
    run samples zero or one. Comparing two scenarios on that draw is comparing
    coin flips: the bike-lane lever would show an improvement or a regression
    depending on the seed, which is precisely the "planner acts on noise"
    failure this engine exists to prevent.

    Summing expected values instead gives the unbiased estimate with none of the
    variance, so a 55% risk reduction reads as a 55% reduction every time. The
    cost is that "3.4 incidents" is an expectation rather than a count, which is
    the honest thing for a rare event anyway.
    """
    rate = BASE_INCIDENT_RATE_PER_KM * (distance_m / 1000.0)
    rate *= 1.0 + 1.6 * max(0.0, min(1.0, zone.congestionIndex))

    if spec.weather.precipitationMm > 0:
        rate *= 1.0 + 0.05 * spec.weather.precipitationMm

    # The whole point of protected infrastructure.
    if zone.zoneId in set(spec.policy.bikeLaneZones):
        rate *= 0.45

    return min(1.0, rate)


class Simulation:
    """One run. Construct, `run()`, read `state`."""

    def __init__(self, spec: ScenarioSpec, progress: ProgressFn | None = None) -> None:
        self.spec = spec
        self.rng = random.Random(spec.seed)
        self.env = simpy.Environment()
        self.progress = progress
        self.state = RunState()

        self.zones: dict[str, ZoneSpec] = {z.zoneId: z for z in spec.zones}
        self.fleet = build_fleet(spec, self.rng)
        self.vehicles: dict[str, Vehicle] = {v.vehicleId: v for v in self.fleet}
        self.arrivals = build_arrivals(spec, self.rng)

        self._by_zone: dict[str, list[Vehicle]] = {z.zoneId: [] for z in spec.zones}
        for v in self.fleet:
            self._by_zone[v.zoneId].append(v)

        self._closed = set(spec.policy.closedZones)
        self._horizon = spec.simHours * 3600.0

    # ---- vehicle bookkeeping ------------------------------------------------

    def _move(self, vehicle: Vehicle, to_zone: str) -> None:
        """The single place a vehicle changes zone.

        Funnelling every move through one method is what makes the conservation
        invariant checkable: a vehicle appears in exactly one zone bucket.
        """
        self._by_zone[vehicle.zoneId].remove(vehicle)
        vehicle.zoneId = to_zone
        self._by_zone[to_zone].append(vehicle)

    def _find_vehicle(self, zone_id: str) -> tuple[Vehicle | None, float, str]:
        """Nearest usable vehicle a rider will walk to.

        Returns (vehicle, walk_metres, reason_if_none).
        """
        origin = self.zones[zone_id]

        # Own zone first. Walk distance is drawn rather than computed because
        # within a zone we do not model where the rider or the vehicle stands.
        here = [v for v in self._by_zone[zone_id] if v.usable]
        if here:
            # Sort by id first so the candidate list does not depend on the
            # order vehicles happen to have been appended to the bucket, then
            # draw uniformly.
            #
            # The draw matters. Taking `here[0]` is deterministic but biased:
            # ids are handed out scooters-first, so a scooter would be chosen
            # whenever one existed and bikes would sit unused all day — an
            # artefact of id assignment masquerading as a finding about mode
            # preference. A rider standing in a zone takes whatever is to hand.
            here.sort(key=lambda v: v.vehicleId)
            return here[self.rng.randrange(len(here))], self.rng.uniform(
                50.0, 0.9 * MAX_WALK_M
            ), ""

        # Spill over to a neighbouring zone only if it is genuinely walkable.
        best: tuple[Vehicle, float] | None = None
        for other_id, bucket in self._by_zone.items():
            if other_id == zone_id or other_id in self._closed:
                continue
            other = self.zones[other_id]
            d = haversine_m((origin.lat, origin.lng), (other.lat, other.lng))
            if d > MAX_WALK_M:
                continue
            usable = [v for v in bucket if v.usable]
            if not usable:
                continue
            usable.sort(key=lambda v: v.vehicleId)
            if best is None or d < best[1]:
                best = (usable[0], d)

        if best is not None:
            return best[0], best[1], ""

        # Distinguish "none here" from "all flat" — different fixes.
        stranded = [v for v in self._by_zone[zone_id] if v.riderId is None]
        return None, 0.0, "battery" if stranded else "no_vehicle"

    # ---- processes ----------------------------------------------------------

    def _rider(self, arrival: Arrival) -> simpy.Event:
        """Rider agent: request, walk, ride, park."""
        yield self.env.timeout(max(0.0, arrival.at - self.env.now))

        if arrival.originZone in self._closed or arrival.destZone in self._closed:
            self.state.unserved.append(arrival)
            self._count_unserved("closed_zone")
            return

        vehicle, walk_m, reason = self._find_vehicle(arrival.originZone)
        if vehicle is None:
            self.state.unserved.append(arrival)
            self._count_unserved(reason)
            return

        # Claim before walking. Without this the same vehicle is promised to
        # every rider who arrives during the walk.
        vehicle.riderId = arrival.riderId
        if vehicle.zoneId != arrival.originZone:
            vehicle.emptyM += walk_m

        walk_seconds = walk_m / (WALK_SPEED_KPH * 1000.0 / 3600.0)
        yield self.env.timeout(walk_seconds)

        origin = self.zones[arrival.originZone]
        dest = self.zones[arrival.destZone]
        distance_m = haversine_m((origin.lat, origin.lng), (dest.lat, dest.lng))
        if arrival.originZone == arrival.destZone:
            # An intra-zone hop is real travel, not a zero-length trip.
            distance_m = self.rng.uniform(600.0, 2200.0)

        speed = effective_speed_kph(vehicle.kind, origin, self.spec)
        ride_seconds = distance_m / (speed * 1000.0 / 3600.0)

        battery_cost = BATTERY_PCT_PER_KM[vehicle.kind] * distance_m / 1000.0
        risk = incident_risk(distance_m, origin, self.spec)

        yield self.env.timeout(ride_seconds)

        vehicle.batteryPct = max(0.0, vehicle.batteryPct - battery_cost)
        vehicle.loadedM += distance_m
        vehicle.trips += 1
        vehicle.busySeconds += walk_seconds + ride_seconds
        if vehicle.zoneId != arrival.destZone:
            self._move(vehicle, arrival.destZone)
        vehicle.riderId = None

        self.state.trips.append(
            TripRecord(
                riderId=arrival.riderId,
                vehicleId=vehicle.vehicleId,
                kind=vehicle.kind,
                originZone=arrival.originZone,
                destZone=arrival.destZone,
                startedAt=arrival.at,
                waitSeconds=walk_seconds,
                rideSeconds=ride_seconds,
                distanceM=distance_m,
                incidentRisk=risk,
            )
        )

    def _count_unserved(self, reason: str) -> None:
        self.state.unservedReasons[reason] = self.state.unservedReasons.get(reason, 0) + 1

    def _rebalancer(self) -> simpy.Event:
        """Moves idle vehicles from surplus zones to starved ones.

        Deliberately simple — greedy, surplus to deficit. M07 replaces it with a
        min-cost assignment; this exists so the *lever* is testable now.
        """
        interval = self.spec.policy.rebalanceIntervalMin * 60.0
        capacity = self.spec.policy.rebalanceVanCapacity

        while True:
            yield self.env.timeout(interval)
            if self.env.now >= self._horizon:
                return

            idle = {
                zid: [v for v in bucket if v.usable]
                for zid, bucket in self._by_zone.items()
                if zid not in self._closed
            }
            if len(idle) < 2:
                continue

            mean = sum(len(v) for v in idle.values()) / len(idle)
            surplus = sorted(
                (z for z in idle if len(idle[z]) > mean * 1.35),
                key=lambda z: (-len(idle[z]), z),
            )
            deficit = sorted(
                (z for z in idle if len(idle[z]) < mean * 0.65),
                key=lambda z: (len(idle[z]), z),
            )

            moved = 0
            for to_zone in deficit:
                if moved >= capacity:
                    break
                for from_zone in surplus:
                    if moved >= capacity or not idle[from_zone]:
                        break
                    vehicle = idle[from_zone].pop()
                    d = haversine_m(
                        (self.zones[from_zone].lat, self.zones[from_zone].lng),
                        (self.zones[to_zone].lat, self.zones[to_zone].lng),
                    )
                    self._move(vehicle, to_zone)
                    vehicle.emptyM += d
                    self.state.rebalanceMoves += 1
                    self.state.rebalanceDistanceM += d
                    moved += 1

    # ---- driver -------------------------------------------------------------

    def _schedule(self) -> None:
        for arrival in self.arrivals:
            self.env.process(self._rider(arrival))
        if self.spec.policy.rebalanceEnabled:
            self.env.process(self._rebalancer())

    def _snapshot(self) -> dict:
        now = min(self.env.now, self._horizon)
        return {
            "pct": min(1.0, now / self._horizon) if self._horizon else 1.0,
            "simSeconds": round(now, 1),
            "tripsServed": len(self.state.trips),
            "tripsUnserved": len(self.state.unserved),
        }

    def run_iter(self) -> Iterator[dict]:
        """Runs the clock, yielding a progress snapshot as it goes.

        Stepping the environment by hand rather than calling `env.run()` is what
        lets progress *stream*. A callback fired from inside a SimPy process
        cannot yield to an HTTP response — it can only append to a list, which
        would deliver the whole progress history after the run had already
        finished. Driving `env.step()` from a generator inverts that.

        design.md §2 says progress every 100 sim-steps. At a 1-second step that
        is 864 messages per simulated day, which no socket needs; this reports
        at most ~200 times per run and the effect is the same live progress bar.
        """
        self._schedule()

        # Riders mid-ride at the horizon are allowed to finish; cutting them off
        # would bias mean trip time downward by truncating the longest trips.
        report_every = max(60.0, self._horizon / 200.0)
        next_report = report_every

        while self.env.peek() < float("inf"):
            self.env.step()
            if self.env.now >= next_report:
                yield self._snapshot()
                # Jump past any reports the last event skipped over rather than
                # emitting a burst of them for one long timeout.
                while next_report <= self.env.now:
                    next_report += report_every

        yield self._snapshot()

    def run(self) -> RunState:
        for snapshot in self.run_iter():
            if self.progress is not None:
                self.progress(snapshot["pct"], snapshot)
        return self.state
