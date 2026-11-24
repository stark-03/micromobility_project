# ADR 0005 — One role table, and a fleet feed scoped by room

Date: 2026-11-04 · Status: accepted · M01 access control, M03 live fleet

## Context

Mutations were role-checked, but most reads were open to anyone signed in, and
every role saw every screen. A commuter could read the whole fleet, the planners'
scenarios and the city's analytics. Vehicle status events also went to every
connected socket, including riders and other operators.

## Decisions

**1. One table, `ACCESS`, in `packages/shared-types`.** The API enforces it with
`requireRole(...ACCESS.rule)`, and the web app reads it to decide which screens and
buttons to show. A rule lives in one place, so the UI cannot offer what the API
refuses. The UI is a courtesy; the API is the gate.

**2. Fields are scoped as well as routes.** `visibleTo()` removes the rider's name
and the unlock code from a vehicle for roles that may read the fleet but not those
fields. A planner needs to know a vehicle is rented, not who is on it.

**3. Fleet events go to rooms joined on connect.** Admins, planners and analysts
join `fleet:all`; an operator joins `operator:<id>`. Riders receive only
`stations:changed`, which says that counts moved and carries no vehicle.
`vehicle:position` carries a vehicle and never a person, and is emitted after the
commit, so staff are never told about a move that rolled back.

**4. The rate limit is keyed by user, by reading the token.** The limiter runs
before the routers' `requireAuth`, so `req.user` was never set and every request
fell back to the IP address. A rider's tab and an admin's tab on one machine shared
one allowance of 100 requests a minute, which live updates would exhaust.

**5. Position updates are coalesced on the client.** Riders send a fix about once
a second; the fleet list refetches at most every 3 s. A 30 s poll covers a dropped
socket, so nothing on screen depends on the socket being up.

## Consequences

The socket now reads its token on every connection, because the sign-in token
expires after 15 minutes and a reconnect would be refused. It is closed on sign-out,
so the next person on that tab cannot inherit the previous user's rooms.

Seeded demo vehicles can have status `in_use` with no rental behind them. The Fleet
strip therefore shows the status count and "N on rentals now" separately.

## Addendum, 2026-11-23: dashboards and role assignment

Each role now signs in to its own dashboard (`DASHBOARDS`): admin to Admin, operator
to Fleet, planner to Sim, analyst to Data, commuter to Ride. The Admin dashboard gained
a Users tab, the one place a self-registered commuter can be given another role.

Granting `operator` now requires an operator company. Before, the API granted the role
without one, and `operatorScope()` read the missing company as "no filter", so such an
operator saw and could edit every company's fleet. A company-less operator now sees
nothing, and removing the operator role clears the company.

