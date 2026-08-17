# ADR 0003 — The simulation is mesoscopic, not microscopic

Date: 2026-08-17 · Status: accepted · Sprint 4 (M06)

## Context

`design.md` §5 specifies the simulation world as "a snapshot of `road_segments`
with per-slot congestion". Read literally, that puts every simulated rider on
the 9,212-segment OSM graph, routed turn by turn.

A 24-hour run generates roughly 2,300 trips today and would generate tens of
thousands for a full-size deployment. Routing each one through A\* over that
graph costs milliseconds per trip; the run goes from well under a second to
minutes. That is not fatal on its own, but it changes what the feature *is*: a
planner comparing four scenarios wants an answer while the thought is still
warm, and a run they must wait minutes for is a run they do once.

## Decision

Riders travel **zone centroid to zone centroid** at a congestion-adjusted
speed. Congestion, weather and infrastructure modify the speed and the incident
rate; the street geometry itself is not traversed.

The router (M04) remains the microscopic view and still runs A\* over the real
graph for a single journey. Both read the same zones and the same
`traffic_snapshots` congestion index.

## Why this does not cost accuracy where it matters

The metrics a planner acts on — unmet demand, mean wait, vehicle utilisation,
where the fleet runs dry — are set by **where vehicles are relative to
riders**, not by which street a rider took. A rider who waits four minutes for
a scooter waits four minutes regardless of the route afterwards. Per-segment
routing would add precision to trip *duration* only, and trip duration is
already dominated by congestion, which is modelled.

It also preserves the property `design.md` §1 actually asks for: that a
simulated result be comparable to a measured one. Both views consume the same
zone definitions and the same congestion index, so they describe one city.

## Consequences

- A 24-hour, 220-vehicle, 8-zone run completes in ~200 ms end to end. Comparing
  four scenarios is interactive.
- The simulation cannot answer per-street questions — "does closing this
  junction help?" is out of scope. Zone-level closure is the finest lever.
- `MAX_WALK_M` governs whether a rider will use a vehicle in a neighbouring
  zone. With Belagavi's zone sizes, centroids are further apart than that, so
  in practice riders use vehicles in their own zone. That is a modelling limit
  worth stating, not a bug.
- If per-street questions become a requirement, the upgrade path is to run the
  existing A\* per trip behind a scenario flag, accepting the runtime. Nothing
  in the engine's interface would change.

## Related

`design.md` §11 asks whether SUMO is worth integrating as an external
microsimulator for validation, deferred to after Sprint 4. This ADR does not
answer that; it records why the in-house loop is deliberately coarser than the
routing layer next to it.
