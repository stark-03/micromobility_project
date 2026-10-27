# ADR 0004 — A rental is a trip row, and a return is verified by position

Date: 2026-10-26 · Status: accepted · M08 stations, M14 rentals and billing, M09 route risk

## Context

The rider requirements added renting a vehicle end to end: rental stations with
live inventory, unlock by QR code, GPS tracking, a verified return, a fare
quoted before the ride and charged after it, receipts, and an eco summary.
MODULES.md had specified M08 and M14 but neither was built.

Three design questions had more than one reasonable answer.

## Decisions

**1. A rental is a `trips` row, not a new `rentals` table.** The trips table
already feeds the nightly rollups, the analytics screens and the rider's
history. A separate rentals table would mean two records of one journey that
could disagree, and every report would need to union them. Migration 29 adds
the rental columns to `trips`: stations at each end, the tariff used, the fare
and its breakdown, battery at each end, energy and CO2.

**2. "One active ride per rider" and "one rider per vehicle" are enforced by
the schema.** Two generated columns hold the user and vehicle ids only while a
trip is `active`, each with a UNIQUE key. Two taps on Unlock cannot both
succeed, however the requests interleave. The service maps the duplicate-key
error to `RENTAL_ALREADY_ACTIVE`.

**3. Station inventory is derived, not stored.** A vehicle "is at" a station
when `vehicles.station_id` points there. Counts by type and status are computed
on read. Renting clears the pointer and a verified return sets it. Charging and
maintenance leave it in place, because the vehicle still physically takes up
the dock.

## Verified return

Ending a ride is refused unless the vehicle's position is within the station's
`return_radius_m` (default 150 m) and the station has a free dock. The refusal
carries the nearest station's id, name and distance, so the client can direct
the rider there. The vehicle goes `in_use → returning → available`, or to
`charging` at 20% battery or below, through the state machine, so the status
history shows the return.

## Payment

Payment is taken after the trip is committed, through the `PaymentGateway`
adapter. Only `MockGateway` exists. If the charge fails, the ride is still
over and the vehicle still returned; the payment stays `failed` and the rider
retries it from the receipt. A payment outage never holds a rider on a vehicle.
No card data is stored, only the provider's reference.

## GPS

Fixes from a phone (`source = 'gps'`) count toward distance only when the step
from the previous fix is plausible (under 60 km/h, or under 30 m of jitter).
The fix is stored either way. Simulated fixes (`source = 'simulated'`) replay a
planned route faster than real time for demos on machines with no GPS, and are
labelled so they are never mistaken for a real trace.

## Route risk

Route risk is scored in the API, not the ML service, because accident history
and road surveys live in MySQL and the ML service holds no database
credentials. Five factors are each scaled 0–1 per segment and averaged over the
route by length: accidents (severity-weighted, last three years), road quality,
traffic, lighting and cycling infrastructure. The weights are a stated
judgement, listed in `modules/safety/risk.ts`. The bands are low (under 35),
medium (35 to 59) and high (60 and up). Accident history and surface quality
also feed the `safest` routing profile's cost, so that profile avoids the roads
the score calls risky.

The seeded incidents and surveys are synthetic and labelled
`source = 'synthetic'`.
