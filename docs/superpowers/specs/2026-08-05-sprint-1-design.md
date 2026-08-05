# Sprint 1 Design — Foundation, Auth, Vehicle Registry

**Date:** 2026-08-05
**Project:** AI Urban Micro Mobility Simulator
**Covers:** repo scaffold, database layer, Belagavi seed, M01 User & Access Management,
M03 Vehicle Management, adapter shells, frontend foundation, Sign-in + Fleet screens, tests.
**Source specs:** `CLAUDE.md`, `docs/design.md`, `docs/MODULES.md`, `KICKOFF_PROMPT.md`.

---

## 1. Scope

Sprint 1 delivers M01 and M03 complete, plus everything they stand on. Nothing from
M02 or M04–M16 is built, stubbed, or given a placeholder folder.

**In scope**

1. npm-workspaces monorepo: `apps/web`, `apps/api`, `packages/shared-types`.
2. Sequelize 6 + `mysql2` + umzug migrations; 16 tables.
3. Idempotent synthetic Belagavi seed.
4. M01 — auth, profile, preferences, saved places, travel history, admin users, API keys.
5. M03 — vehicle CRUD, status state machine, status history, telemetry, maintenance tickets.
6. Adapter shells: cache, job runner, event bus.
7. Frontend foundation: tokens, Tailwind + MUI integration, app shell, router with auth guard.
8. Two screens: Sign in, Fleet.
9. Vitest unit tests + Supertest integration tests.
10. `README.md` with exact setup for this machine.

**Explicitly out of scope**

Socket.IO gateway, traffic ingest, weather, routing, ML service, simulation, rollups,
MapLibre/deck.gl, Recharts, Playwright, Redis, Docker.

`realtime/bus.ts` ships in Sprint 1 because M01/M03 mutations publish to it, but no
Socket.IO gateway consumes it until Sprint 2. That is intentional, not a partial build:
the bus is the seam the gateway attaches to.

---

## 2. Decisions taken during design

These resolve ambiguities in the source specs. Each was confirmed with the project owner.

| # | Question | Decision |
|---|---|---|
| D1 | Five M01/M03 endpoints reference tables absent from the kickoff's twelve-table list | **Add all four missing tables** (`trips`, `saved_places`, `maintenance_tickets`, `vehicle_telemetry`) and ship M01 and M03 complete. 16 tables total. |
| D2 | Vehicle state machine edge set is unspecified | **Operational graph** (§5). `reserved` is optional; `maintenance`/`charging` reachable from any live state; `retired` is terminal. |
| D3 | `design.md` §9 requires per-test transaction rollback, which cannot work over Supertest | **Split strategy** — truncate-and-reseed for HTTP tests, transaction rollback for direct service tests. Recorded in `docs/adr/0001-test-isolation.md`. |
| D4 | MySQL credentials | **root in `.env`**, per owner's decision. `.env` gitignored from the first commit; `.env.example` holds placeholders only. |
| D5 | Repo location and spec doc paths | git repo at the project root; `design.md` and `MODULES.md` moved into `docs/` to match the paths `CLAUDE.md` references. |
| D6 | Conflicting `CLAUDE.md` in a parent directory (Belgaum Matrimony, PHP Laravel) | **Left untouched** at owner's instruction. This project's `CLAUDE.md` is authoritative; the parent file does not apply and is disregarded. |

### Assumptions

1. Self-registration grants the **`commuter` role only**. Every elevated role is granted by an
   admin through `PATCH /admin/users/:id/roles`.
2. **No Sign-up screen.** `POST /auth/register` ships; the UI does not. Kickoff item 8 names
   exactly two screens.
3. Tooling: ESLint 9 flat config + Prettier, Vitest workspace at the repo root. No Playwright —
   E2E lands in Sprint 6.
4. Belagavi geography is **synthetic but anchored** on real coordinates and locality names, per
   `design.md` §11 open question 1. The ingest contract is identical either way.
5. `/readyz` reports the ML service as `not_configured` rather than failing, since that service
   does not exist until Sprint 3.

---

## 3. Repository structure

Only directories with real content in Sprint 1 are created.

```
/apps
  /api
    /src
      /config          env loading, sequelize config
      /db
        /migrations    16 umzug migrations
        /models        Sequelize model definitions + associations
        /seeders       Belagavi demo city
        spatial.ts     the ONLY place geometry is read or written
        index.ts       sequelize instance
      /middleware      auth, rbac, validate, error, rateLimit
      /modules
        /auth          routes, controller, service, dto, tokens
        /users         routes, controller, service, dto
        /admin         users + api-keys
        /vehicles      routes, controller, service, dto, stateMachine.ts
        /health        healthz, readyz
      /cache           index.ts (CacheDriver + memory), keys.ts
      /jobs            runner.ts, drivers/inline.ts
      /realtime        bus.ts
      /lib             errors.ts, envelope.ts, cursor.ts, logger.ts
      app.ts           express app factory (no listen)
      server.ts        entrypoint
    /tests
      /unit
      /integration
      helpers/         truncate, fixtures, authAs
  /web
    /src
      /app             router, providers, theme.ts, guard
      /modules
        /auth          SignIn screen
        /fleet         Fleet screen
      /components      AppShell, TopBar, IconRail, StateViews
      /lib             api client, queryKeys, hooks
      /styles          tokens.css, tailwind.css
/packages
  /shared-types        envelopes, enums, DTOs shared by web + api
/docs
  design.md  MODULES.md  /adr  /superpowers/specs
```

---

## 4. Data model

### 4.1 Migration order

FK-safe. Each migration is immutable once merged; fixes go forward.

| # | Table | Purpose |
|---|---|---|
| 01 | `roles` | admin, planner, operator, commuter, analyst, device |
| 02 | `operators` | fleet owners — precedes `users` because `users.operator_id` references it |
| 03 | `users` | identity, soft-deleted |
| 04 | `user_roles` | many-to-many |
| 05 | `refresh_tokens` | rotating families with reuse detection |
| 06 | `user_preferences` | 1:1 with users |
| 07 | `saved_places` | `POINT` SRID 4326 |
| 08 | `api_keys` | device identities |
| 09 | `audit_logs` | sensitive action trail |
| 10 | `zones` | verbatim from `design.md` §3.2 |
| 11 | `road_segments` | graph edges (§4.3) |
| 12 | `vehicles` | verbatim from `design.md` §3.2 |
| 13 | `vehicle_status_history` | every transition |
| 14 | `vehicle_telemetry` | partitioned, high volume |
| 15 | `maintenance_tickets` | |
| 16 | `trips` | travel history |

Conventions from `CLAUDE.md` apply throughout: `snake_case` plural tables, `PascalCase` singular
models, `BIGINT UNSIGNED AUTO_INCREMENT` id, `DATETIME(3)` UTC timestamps, `DECIMAL` for money,
`deleted_at` only where history matters (`users`, `vehicles`).

### 4.2 Notable columns beyond the source specs

**`users.operator_id BIGINT UNSIGNED NULL`** — FK to `operators`. `MODULES.md` M01 does not
list it, but RBAC needs it: a user holding the `operator` role must be scoped to one operator's
fleet, otherwise "operator" means "operator of everything". Nullable, since admins, planners,
analysts and commuters have no operator.

**`refresh_tokens`** — `family_id CHAR(36)`, `token_hash CHAR(64) UNIQUE`, `issued_at`,
`expires_at`, `used_at NULL`, `revoked_at NULL`,
`revoked_reason ENUM('rotated','logout','reuse_detected','expired') NULL`,
`replaced_by_id NULL`, `user_agent`, `ip VARBINARY(16)`.

**`trips.public_ref CHAR(36) UNIQUE`** — the pseudonymous trip identifier required by
`design.md` §7. Analytics tables reference `public_ref`, never `user_id`.

### 4.3 `road_segments` — designed here

`design.md` §3.2 gives DDL for `zones`, `vehicles`, `traffic_readings` and `simulation_runs`
but not this table. Designed now to carry M02's readings, M04's A\* graph and M09's safety
scores without needing a later migration against a populated table.

```sql
CREATE TABLE road_segments (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  zone_id         BIGINT UNSIGNED  NULL,
  name            VARCHAR(160)     NULL,
  external_ref    VARCHAR(64)      NULL,
  from_node       VARCHAR(32)      NOT NULL,
  to_node         VARCHAR(32)      NOT NULL,
  geometry        LINESTRING       NOT NULL SRID 4326,
  length_m        DECIMAL(10,2)    NOT NULL,
  speed_free_kph  DECIMAL(5,2)     NOT NULL,
  lanes           TINYINT UNSIGNED NOT NULL DEFAULT 1,
  one_way         BOOLEAN          NOT NULL DEFAULT 0,
  gradient_pct    DECIMAL(5,2)     NOT NULL DEFAULT 0.00,
  road_class      ENUM('arterial','collector','local','path','cycleway') NOT NULL,
  has_bike_lane   BOOLEAN          NOT NULL DEFAULT 0,
  lit             BOOLEAN          NOT NULL DEFAULT 1,
  created_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                   ON UPDATE CURRENT_TIMESTAMP(3),
  SPATIAL INDEX idx_rs_geometry (geometry),
  KEY idx_rs_zone (zone_id),
  KEY idx_rs_nodes (from_node, to_node),
  CONSTRAINT fk_rs_zone FOREIGN KEY (zone_id) REFERENCES zones(id)
) ENGINE=InnoDB;
```

`from_node`/`to_node` are graph vertex labels, not FKs — there is no `nodes` table, and A\*
in Sprint 3 builds its adjacency from these two columns.
`gradient_pct` feeds the `w_g·gradient_penalty` term of the `design.md` §4 edge cost.
`has_bike_lane` and `lit` are M09 safety inputs.

### 4.4 `vehicle_telemetry` — partitioning consequences

Mirrors `traffic_readings`: `PRIMARY KEY (id, recorded_at)`,
`PARTITION BY RANGE (TO_DAYS(recorded_at))` with monthly partitions plus `pmax`. Sprint 1
creates partitions for the current and next few months; the monthly maintenance job is
Sprint 2 work.

Four MySQL facts this forces, none of which appear in the source specs:

1. **Partitioned tables cannot carry foreign keys.** `vehicle_telemetry.vehicle_id` gets an
   index and application-level integrity instead. `traffic_readings` in `design.md` §3.2
   already reflects this constraint.
2. **Partitioned tables cannot carry SPATIAL indexes.**
3. **Partitioned tables cannot carry `GEOMETRY` columns at all** — not merely their indexes.
   Discovered during implementation: a `POINT` column on this table fails outright with
   `ER_CHECK_NOT_IMPLEMENTED`, *"The storage engine for the table doesn't support GEOMETRY"*.
   This corrects point 2 as originally written, which assumed the column was storable and only
   the index forbidden.

   **Resolution:** position is stored as `lat DECIMAL(9,6)` and `lng DECIMAL(10,6)`. Six decimal
   places is roughly 0.11 m, comfortably inside GPS error. The DTO mapper rebuilds a `GeoPoint`,
   so `TelemetryDto.position` is unchanged and the API contract matches every other positioned
   entity. Nothing is lost: telemetry is only ever queried by `vehicle_id` + time range, never
   spatially. `traffic_readings` in `design.md` §3.2 carries no geometry column either — it
   references `segment_id` and lets `road_segments` hold the shape — which is the same pattern
   arrived at independently.
4. **`DECIMAL` returns from `mysql2` as a string.** DTO mappers convert at the API boundary so
   no consumer ever receives a string where the contract promises a number. This now also
   applies to telemetry `lat`/`lng`.

---

## 5. Vehicle state machine

A pure function in `modules/vehicles/stateMachine.ts` with no I/O, no clock, no database.
`MODULES.md` M03 writes the states as a linear chain; that is a reading order, not the
transition graph. The graph below is the contract.

```
available   → reserved, in_use, charging, maintenance, retired
reserved    → in_use, available, maintenance
in_use      → returning, maintenance
returning   → available, charging, maintenance
charging    → available, maintenance, retired
maintenance → available, charging, retired
retired     → (terminal)
```

**19 legal edges** out of 42 ordered pairs of distinct states. Rationale:

- `available → in_use` direct, because scan-and-go unlock skips reservation.
- `reserved → available` covers reservation timeout and rider cancellation.
- `in_use → maintenance` and `returning → maintenance`, because breakdowns happen mid-ride.
- `retired` is terminal. A one-way door makes `retired` a trustworthy filter; refurbishment is
  modelled by registering a new vehicle record, not by resurrecting a retired one.

Illegal transitions raise `INVALID_STATE_TRANSITION` (HTTP 409). Every accepted transition
writes a `vehicle_status_history` row inside the same database transaction as the
`vehicles.status` update, and publishes `vehicle:status` on the event bus.

Tests assert the full 7×7 matrix — **49 pairs: 19 accepted, 30 rejected** (23 illegal transitions
between distinct states, plus 7 self-transitions, which are rejected rather than treated as
no-ops so a duplicated request cannot write a spurious history row). A separate case asserts
`retired` accepts nothing.

---

## 6. Spatial handling — the one real technical risk

**Sequelize 6 does not pass an `axis-order` option to MySQL's spatial functions.** MySQL 8
treats SRID 4326 as **latitude-longitude**. GeoJSON, MapLibre and deck.gl all use
**longitude-latitude**. Left unmanaged, every coordinate in the project transposes silently and
Belagavi (15.85 N, 74.50 E) is written as a point in the Indian Ocean.

**Mitigation**

- Spatial columns are declared in migrations as **raw DDL** via `queryInterface.sequelize.query`,
  not through Sequelize's `GEOMETRY` type.
- All geometry reads and writes go through `apps/api/src/db/spatial.ts`, which emits
  `ST_GeomFromText(?, 4326, 'axis-order=long-lat')` on write and
  `ST_AsText(col, 'axis-order=long-lat')` on read.
- Models expose geometry as GeoJSON-shaped plain objects in `[lng, lat]` order. No other file
  in the codebase touches a spatial function.
- A unit test round-trips a known Belagavi point through write → read and asserts the
  coordinates come back unchanged and in `[lng, lat]` order.

---

## 7. API contract

Base path `/api/v1`. Public GBFS (`/gbfs/*`) is Sprint 6 and absent here.

Success envelope `{ "data": ..., "meta": { ... } }`; error envelope
`{ "error": { "code": "...", "message": "...", "details": [...] } }`. `code` is a stable
SCREAMING_SNAKE string. Every request body and query is parsed with **zod** at the route
boundary; controllers receive typed input and never touch `req` beyond `req.user`.

### 7.1 Endpoints

```
POST   /auth/register                       public, grants commuter
POST   /auth/login                          public
POST   /auth/refresh                        cookie only
POST   /auth/logout                         authenticated

GET    /users/me                            any authenticated
PATCH  /users/me
GET    /users/me/preferences
PATCH  /users/me/preferences
GET    /users/me/trips?cursor=&limit=       cursor paginated
GET    /users/me/places
POST   /users/me/places
PATCH  /users/me/places/:id
DELETE /users/me/places/:id

GET    /admin/users?page=&limit=&role=&status=      admin
PATCH  /admin/users/:id/roles                       admin
GET    /admin/api-keys                              admin
POST   /admin/api-keys                              admin
DELETE /admin/api-keys/:id                          admin

GET    /vehicles?zoneId=&status=&type=&operatorId=&page=&limit=   any authenticated
POST   /vehicles                                    operator, admin
GET    /vehicles/:id                                any authenticated
PATCH  /vehicles/:id                                operator, admin
PATCH  /vehicles/:id/status      { to, reason }     operator, admin
GET    /vehicles/:id/status-history
GET    /vehicles/:id/telemetry?from=&to=&cursor=    cursor paginated
GET    /vehicles/:id/maintenance
POST   /vehicles/:id/maintenance                    operator, admin
PATCH  /maintenance/:id                             operator, admin

POST   /ingest/telemetry                            API-key auth, device scope

GET    /healthz                                     public, liveness
GET    /readyz                                      public, MySQL check
```

Pagination follows the CLAUDE.md rule: **cursor-based for feeds** (`trips`, `telemetry`),
**offset-based for admin tables** (`admin/users`, `vehicles`).

`/readyz` returns MySQL status and reports the ML service as `not_configured`. It does not fail
on ML absence until Sprint 3 introduces the service.

### 7.2 Error codes

| Code | HTTP |
|---|---|
| `VALIDATION_FAILED` | 400 |
| `UNAUTHENTICATED` | 401 |
| `INVALID_CREDENTIALS` | 401 |
| `TOKEN_EXPIRED` | 401 |
| `REFRESH_TOKEN_INVALID` | 401 |
| `REFRESH_TOKEN_REUSED` | 401 |
| `FORBIDDEN` | 403 |
| `USER_NOT_FOUND` | 404 |
| `VEHICLE_NOT_FOUND` | 404 |
| `MAINTENANCE_TICKET_NOT_FOUND` | 404 |
| `SAVED_PLACE_NOT_FOUND` | 404 |
| `EMAIL_ALREADY_REGISTERED` | 409 |
| `VEHICLE_REF_ALREADY_EXISTS` | 409 |
| `INVALID_STATE_TRANSITION` | 409 |
| `RATE_LIMITED` | 429 |
| `INTERNAL_ERROR` | 500 |

### 7.3 RBAC matrix

| Route group | admin | planner | operator | analyst | commuter | device |
|---|---|---|---|---|---|---|
| `/auth/*` | public | public | public | public | public | — |
| `/users/me*` | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `/admin/*` | ✓ | — | — | — | — | — |
| `GET /vehicles*` | ✓ | ✓ | ✓ (own operator) | ✓ | ✓ | — |
| `POST`/`PATCH /vehicles*` | ✓ | — | ✓ (own operator) | — | — | — |
| `POST /ingest/telemetry` | — | — | — | — | — | ✓ |

Operator scoping is enforced in the service layer against `users.operator_id`, not in the
route guard — `requireRole` establishes *which* roles may call, the service establishes
*which rows* they may touch.

---

## 8. Authentication

Per `design.md` §7.

- **Access token** — JWT, 15 minutes, held in memory on the client only. Never written to
  `localStorage` or `sessionStorage`.
- **Refresh token** — 7 days, `httpOnly` + `SameSite=Strict` + `Secure` in production, path
  scoped to `/api/v1/auth`. Only a SHA-256 hash is stored server-side; the raw token exists
  solely in the cookie.
- **Rotation** — every successful refresh marks the presented token `used_at`, issues a
  successor in the same `family_id`, and sets `replaced_by_id`.
- **Reuse detection** — presenting a token whose `used_at` is already set revokes the entire
  family (`revoked_reason = 'reuse_detected'`) and returns `REFRESH_TOKEN_REUSED`. This is the
  signal that a refresh cookie was stolen.
- **Passwords** — bcrypt, cost 12.
- **Rate limits** — 10 login attempts per 15 minutes per IP; 100 requests per minute per user;
  1000 per minute per device key. In-memory limiter, consistent with no-Redis.
- **API keys** — presented as `Authorization: Bearer mm_<prefix>_<secret>`. Stored as
  `key_prefix` (for lookup) plus SHA-256 `key_hash`. The full key is shown exactly once, at
  creation.

Audit-logged actions in Sprint 1: login success and failure, logout, refresh reuse detection,
role grant/revoke, API key create/revoke, vehicle create, vehicle status change, vehicle
soft-delete.

---

## 9. Seed data — synthetic Belagavi

Idempotent by natural key: `zones.code`, `operators.code`, `users.email`,
`vehicles.(operator_id, external_ref)`, `road_segments.external_ref`. Re-running the seed
changes no row counts. Verified by a test that runs the seed twice and compares counts.

| Entity | Count | Detail |
|---|---|---|
| Zones | 8 | Tilakwadi, Camp, Shahapur, Vadgaon, Udyambag, Hindwadi, Sadashiv Nagar, Angol — real locality names, plausible polygons around real centroids |
| Road segments | ~120 | connected graph across all 8 zones |
| Operators | 2 | |
| Vehicles | 60 | across `scooter`, `bike`, `ebike`, `ev`; varied status and battery |
| Users | 5 | one per role: admin, planner, operator, commuter, analyst |
| Trips | ~12 | completed, attached to the commuter account so `/users/me/trips` returns real data |
| Telemetry | ~500 | recent rows for a subset of vehicles |

**Graph connectivity is asserted at seed time.** A union-find pass over `from_node`/`to_node`
runs before insert; if the segments do not form a single connected component the seed fails
loudly. A disconnected graph would silently break A\* in Sprint 3, and the failure would look
like a routing bug rather than a data bug.

Demo account passwords are generated once and **printed to stdout** by the seeder. They are
never committed.

---

## 10. Adapter shells

Real implementations behind interfaces, so Redis is a later driver swap and nothing else.
`redis`, `ioredis` and `bullmq` do not appear in `package.json`.

**`cache/index.ts`** — `CacheDriver` interface `{ get, set, del, wrap }`, backed by `node-cache`
when `CACHE_DRIVER=memory`. `wrap(key, ttl, fn)` is the primary surface. No service calls a
cache library directly. All keys and TTLs are declared in `cache/keys.ts`; Sprint 1 registers
only the keys it uses, and adds `traffic:snapshot`, `route:` and `kpi:` as later sprints need
them.

**`jobs/runner.ts`** — `enqueue(name, payload) → jobId`, deliberately the exact signature BullMQ
would need. `QUEUE_DRIVER=inline` runs the handler on a `worker_threads` worker. Sprint 1 has no
long-running jobs; the runner ships with a trivial registered job and its test, proving the seam
works before Sprint 4 depends on it.

**`realtime/bus.ts`** — typed `EventEmitter` wrapper. Sprint 1 publishers: `vehicle:status`,
`vehicle:created`. No subscriber until the Sprint 2 gateway.

---

## 11. Frontend

**Stack** — Vite + React 18 + TypeScript, MUI v5 + `@mui/x-data-grid`, Tailwind 3.4,
TanStack Query for server state, Zustand for the in-memory access token, `react-router-dom` v6.

**Token discipline** — `styles/tokens.css` carries the `design.md` §6.2 values verbatim. Both
`tailwind.config.js` and `app/theme.ts` read those CSS variables. **No hex literal appears in any
component.** Tailwind runs `corePlugins.preflight: false`; MUI's `CssBaseline` owns the reset;
`StyledEngineProvider injectFirst` lets a Tailwind utility on a wrapper win without
`!important`.

**Division of labour** — Tailwind for flex/grid, gap and padding on plain wrappers. MUI `sx` or
`styled()` inside MUI components. Anything needing `!important` becomes a theme override in
`app/theme.ts` instead.

**Fonts** — Archivo, Inter and IBM Plex Mono self-hosted via `@fontsource`. No external CDN
request.

**App shell** — the `design.md` §6.4 wireframe: 56px top bar, 64px icon rail, content area.
The rail renders all six destinations (Live, Plan, Sim, Fleet, Data, Admin); the five not yet
built are disabled with a tooltip naming their sprint. Showing them honestly beats either
hiding the product's shape or faking working links.

**Screens**

1. **Sign in** — email + password, zod-validated, maps `INVALID_CREDENTIALS` and `RATE_LIMITED`
   to distinct messages, redirects by role.
2. **Fleet** — MUI `DataGrid` over `GET /vehicles`, offset paginated, with the mode-colour dot
   per vehicle type (`--line-scooter` / `bike` / `ebike` / `ev`), a battery column, and a status
   chip. Filters for zone, status and type.

Both handle all four states explicitly: loading (`Skeleton`), empty (with a next action, not
"no data"), error (with retry), ready.

**Deliberately absent** — MapLibre, deck.gl and Recharts. Nothing in Sprint 1 draws a map or a
chart, and omitting them keeps the initial bundle inside the `design.md` §8 target of 250 KB
gzipped.

---

## 12. Testing

**Unit (Vitest)**

- State machine: the full 7×7 matrix — 49 pairs, 19 accepted and 30 rejected.
- Refresh token rotation and family revocation on reuse.
- Spatial round-trip: a known Belagavi point survives write → read in `[lng, lat]` order.
- Cursor encode/decode, including tampered and truncated cursors.
- Password hashing and verification.

**Integration (Supertest against `micromobility_test`)**

- Register → login → access protected route → refresh → logout.
- Refresh reuse returns `REFRESH_TOKEN_REUSED` and kills the family.
- Vehicle CRUD, including `VEHICLE_REF_ALREADY_EXISTS` on duplicate `(operator_id, external_ref)`.
- Legal and illegal status transitions, asserting `INVALID_STATE_TRANSITION` and that a history
  row is written only on success.
- RBAC denials: commuter blocked from `POST /vehicles`, non-admin blocked from `/admin/*`.
- API-key auth on `POST /ingest/telemetry`.
- Seed idempotency: run twice, assert identical row counts.

**Isolation** — per decision D3. HTTP tests truncate all mutable tables between tests and
reseed reference data from a fast fixture, wrapped in `SET FOREIGN_KEY_CHECKS=0/1` with an
FK-safe truncate order. Direct service tests keep transaction rollback. The divergence from
`design.md` §9 is recorded in `docs/adr/0001-test-isolation.md`.

Test runs target `micromobility_test` only. The truncate helper asserts the connected schema
name ends in `_test` and throws otherwise — this MySQL instance hosts fifteen unrelated project
databases and a misconfigured `.env` must not be able to wipe one.

---

## 13. Environment

`.env` is gitignored from the first commit. `.env.example` carries placeholders only.

```
NODE_ENV=development
API_PORT=4000
WEB_PORT=5173
DB_HOST=localhost
DB_PORT=3306
DB_NAME=micromobility
DB_NAME_TEST=micromobility_test
DB_USER=root
DB_PASSWORD=
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=7d
CACHE_DRIVER=memory
QUEUE_DRIVER=inline
ML_SERVICE_URL=http://localhost:8000
ML_INTERNAL_SECRET=dev_only_secret
CORS_ORIGIN=http://localhost:5173
```

Sequelize is configured with `dialectOptions: { allowPublicKeyRetrieval: true }` for local
development only, because MySQL 8.4 removed `mysql_native_password` and `mysql2` needs the
server's public key for the initial `caching_sha2_password` exchange over a plain localhost
connection. This must never be set against a remote server; use TLS there.

Env loading uses `node --env-file=.env`. No `dotenv`, no `nodemon` — Node 22 provides both.

**Credential note.** Per decision D4 the API connects as MySQL `root`, which grants it full
rights over all databases on this instance, including fifteen unrelated projects. The
schema-scoped `mm_app` user described in `CLAUDE.md` remains a one-command change whenever
the owner wants it. The `_test`-suffix guard in the truncate helper (§12) is the compensating
control.

---

## 14. Build stages

Work stops for owner review at each gate.

| Stage | Deliverable |
|---|---|
| **a** | Folder structure, `package.json` files, workspace wiring, tooling config, `.env.example`, `README.md` skeleton |
| **b** | 16 migrations, Sequelize models with associations, `spatial.ts`, seeders, `db:*` scripts |
| **c** | Middleware, M01 modules, M03 modules, adapter shells, unit + integration tests |
| **d** | Frontend foundation, app shell, Sign in, Fleet, final `README.md` |

Each stage ends with a module-scoped commit. `npm run typecheck && npm run lint && npm run test`
must pass before any stage is declared done.

---

## 15. Deferred, with reasons

| Item | Sprint | Why |
|---|---|---|
| Socket.IO gateway + room authorization | 2 | Nothing to broadcast until traffic ingest exists; the bus seam ships now |
| `traffic_readings`, snapshots, ingest | 2 | M02 |
| Monthly partition maintenance job | 2 | Lands with the first partitioned table that grows |
| Weather polling | 2 | M12 |
| `route_cache`, `trip_plans`, A\* | 3 | M04 |
| ML service and Python venv | 3 | M05 |
| `fares`, `wallet_transactions`, pricing | 6 | M14 |
| Playwright E2E | 6 | Needs the scenario → run → results flow to exist |
| Helmet, CORS allowlist hardening, privacy suppression | 6 | Hardening pass |
