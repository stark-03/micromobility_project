# ADR 0006 — Places are where OpenStreetMap says they are

Date: 2026-11-23 · Status: accepted

## Context

A reviewer zoomed into the map and found our labels in the wrong places. The street
map itself (OpenStreetMap tiles, and the road network imported from OSM) was correct.
What was wrong was everything we drew on top of it:

- Landmarks (bus stand, railway station, fort, chargers, rental stations) had
  hand-typed coordinates, 0.5 to 3 km from the real places.
- Zones were a 4×2 grid of rectangles over the city, each named after the
  locality nearest to it. A zone's centre was the middle of its rectangle, so
  "Vadgaon" sat on the west side of the city when the real Vadgaon is in the east,
  4.2 km away.

Changing map provider would not have helped: the same wrong pins would sit on
top of Google's map.

## Decision

- **Every seeded position is OpenStreetMap's own point for that place**, looked up
  with Nominatim on 2026-11-23 and written into the seeders with that date.
  A place OSM does not know by name is not invented: Hindwadi exists in OSM only as a
  road, so the charger is named "Hindwadi Road" and placed on it.
- **Zones are the areas nearest each real locality** (a Voronoi partition clipped to
  the city), so a zone's centre is the place and its edges fall between real
  neighbours. They still cover the city exactly once (tested in
  `tests/unit/zones.test.ts`).
- **Hindwadi is replaced by Khade Bazar.** Hindwadi Road is about 600 m from both
  Shahapur and Vadgaon, which left the city centre (bus stand, fort, Rani Chennamma
  Circle) without a zone of its own.

## Existing databases

Re-running `npm run db:seed` corrects a database seeded before this change:

- The `HND` zone row is renamed to `KHB` in place (`RENAMED_ZONES`), so its trips and
  vehicles follow it. The `RS-HND` hub becomes `RS-KHB` the same way.
- Seeded charging points are moved and renamed by their old names (`formerly`).
  Charging points a planner added are left alone.
- Rental stations' zones are recomputed from their new positions.
