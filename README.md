# AI Urban Micro Mobility Simulator

Simulates, monitors and optimizes urban micro mobility — e-scooters, bicycles, e-bikes and
shared EVs. Ingests traffic and telemetry, forecasts demand and congestion, plans routes, and
runs what-if scenarios in a virtual city so planners can test policy before deploying it.

Dept. of CSE, AITM, Belagavi.

- Architecture: [`docs/design.md`](docs/design.md)
- Module contracts: [`docs/MODULES.md`](docs/MODULES.md)
- Working conventions: [`CLAUDE.md`](CLAUDE.md)

---

## What is built so far

| Built | Not yet |
|---|---|
| M01 users, roles, sign-up, saved places | M08 geofenced parking and no-park zones |
| M02 traffic monitoring, live map, synthetic generator | M09 risk zones and telemetry safety events |
| M03 vehicle registry, status state machine, maintenance | M13 notifications |
| M04 route planning (A\* over real Belagavi streets), place search | M14 subscriptions, wallets, invoices |
| M05 LightGBM demand model and model registry | M16 emergency response |
| M06 simulation engine, scenarios, comparison (incl. energy) | |
| M07 fleet rebalancing (min-cost LP), charging stations | |
| **M08 rental stations** with live inventory and verified returns | |
| **M09 route risk**: accidents, road quality, traffic, lighting, cycling infrastructure → low / medium / high | |
| M10 / M11 environmental accounting, analytics rollups, CSV export | |
| M12 weather · M15 GBFS feed | |
| **M14 rentals**: QR unlock, GPS tracking, fare quotes, mock payments, receipts, eco summary | |

Screens: Live, Plan, **Ride**, **Trips**, Sim, Fleet, Data and Admin. Renting is covered in
ADR 0004 and MODULES.md (M08, M09, M14). Payments use a mock gateway
(`PAYMENT_GATEWAY=mock`) that approves every charge; no card data is ever handled.

---

## Prerequisites

Everything runs **natively**. There is no Docker, no docker-compose, and no Redis.

| Tool | Version | Notes |
|---|---|---|
| Node | **22.18.0 or newer** | 22.23.1 verified. Needed for native TypeScript type stripping |
| npm | 10.x | workspaces |
| MySQL | **8.4 LTS** | 8.4.10 verified |
| Python | 3.13 | not required until Sprint 3 |

Check yours:

```bash
node --version && npm --version && mysql --version
```

### Why Node 22.18+ specifically

The API runs TypeScript directly — `node --watch --env-file=.env src/server.ts`. Node strips the
types itself, so there is no `tsx`, no `ts-node` and no `nodemon` in this project. Type stripping
became on-by-default in 22.18.0. On an older Node the API will not start.

A consequence worth knowing: type stripping can only remove syntax that *erases*. TS `enum`,
`namespace`, parameter properties and decorators do not. `erasableSyntaxOnly` is set in
`tsconfig.base.json` and an ESLint rule bans `enum`, so `npm run typecheck` catches this rather
than the server failing at runtime. Use a `const` object plus a union type instead — see
`packages/shared-types/src/index.ts`.

---

## Database setup

### 1. Create the schemas and the application user

The project's own convention is a schema-scoped user:

```sql
CREATE DATABASE micromobility      CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE micromobility_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE USER 'mm_app'@'localhost'
  IDENTIFIED WITH caching_sha2_password BY 'change_me';

GRANT ALL PRIVILEGES ON micromobility.*      TO 'mm_app'@'localhost';
GRANT ALL PRIVILEGES ON micromobility_test.* TO 'mm_app'@'localhost';
FLUSH PRIVILEGES;
```

`npm run db:create` will create both schemas for you if they don't exist, so in practice you only
need the `CREATE USER` and `GRANT` statements.

> **Current local configuration.** This checkout's `.env` connects as MySQL `root` rather than
> `mm_app`, by the project owner's decision. That grants the API full rights over every database
> on the instance. Switching is a two-line `.env` change — set `DB_USER=mm_app` and
> `DB_PASSWORD=…` after running the SQL above. Nothing in the code depends on which user it is.

### 2. MySQL 8.4 removed `mysql_native_password`

The server authenticates with `caching_sha2_password` and there is no falling back. Two
consequences:

- **Sequelize must use the `mysql2` driver.** The legacy `mysql` package cannot complete the
  handshake. `ER_NOT_SUPPORTED_AUTH_MODE` means something reintroduced it.
- **You do *not* need `allowPublicKeyRetrieval`.** `CLAUDE.md` and `design.md` both ask for it,
  but that is a JDBC option name — Node's `mysql2` has no such setting and warns that a future
  version will throw on it. mysql2 implements `caching_sha2_password` natively and fetches the
  server's public key itself. Removed, with the reasoning in
  [`docs/adr/0002-mysql2-auth.md`](docs/adr/0002-mysql2-auth.md).
- **When this stops talking to localhost, use TLS.** `dialectOptions: { ssl: … }`. The original
  warning against exposing a password exchange to a remote network still stands.

Do not "fix" an auth error by recreating the user with `mysql_native_password`. The plugin is not
in MySQL 8.4.

### 3. Spatial data

Zones, road segments, vehicle positions and trip endpoints use MySQL `POINT`, `LINESTRING` and
`POLYGON` with SRID 4326 and spatial indexes.

MySQL treats SRID 4326 as **latitude-longitude**. GeoJSON, MapLibre and deck.gl use
**longitude-latitude**. Every read and write therefore passes `axis-order=long-lat`, and this
happens in exactly one file: `apps/api/src/db/spatial.ts`. Application code always speaks
`[lng, lat]`. Do not call an `ST_*` function anywhere else — there is a test that pins this.

---

## First run

```bash
cp .env.example .env
# edit .env: set DB_PASSWORD, and generate the two JWT secrets with `openssl rand -hex 32`

npm install
npm run db:create      # creates micromobility and micromobility_test if missing
npm run db:migrate
npm run db:seed        # synthetic Belagavi — prints the demo account passwords ONCE
```

The seeder prints five demo accounts (`admin`, `planner`, `operator`, `commuter`, `analyst`) with
generated passwords. **Copy them — they are not stored anywhere.** Re-running `db:seed` is safe
and idempotent, but it generates new passwords for accounts it creates.

Then:

```bash
npm run dev            # api on :4000, web on :5173
```

Open <http://localhost:5173> and sign in as `admin@belagavi.local`.

---

## Running a five-minute demo

From a cold laptop:

```bash
# 1. MySQL must be running
systemctl is-active mysqld        # or: mysql.server start

# 2. Terminal one — both services
cd "<project root>"
npm run dev                       # api :4000, web :5173

# 3. Terminal two — makes the live map move
npm run traffic:sim -- --hour 18.5 --interval 3000
```

`--hour 18.5` pins the simulation to evening rush. Without it the generator follows the real
clock, so a demo at 11am or 11pm shows a uniformly free-flowing city and demonstrates nothing.
The generator is fully deterministic — no `Math.random` anywhere — so the same demo replays
identically.

Then, in the browser:

1. **<http://localhost:5173>** → redirects to `/signin`.
2. Sign in as `admin@belagavi.local` with the password `db:seed` printed.
   A wrong password shows *"That email and password don't match."* — the screen
   switches on the error **code**, never the message.
3. You land on **Live** — the map. Eight zone polygons, ~121 road segments coloured by
   congestion, and a permanent legend card bottom-left. Watch the colours shift every few
   seconds as the generator ticks and the socket pushes an update.
   - Click any road for its congestion, mean speed and free-flow speed.
   - Toggle **Street basemap** to drop an OpenStreetMap layer underneath. Leave it off if the
     network is unreliable — everything else is drawn from our own seeded data and needs no
     internet at all.
   - The header shows city temperature from the weather poller.
4. Click **Fleet** in the rail: 60 vehicles across two operators and eight Belagavi zones.
   - The coloured dot is the vehicle mode, always beside its label.
   - Battery is monospaced with tabular figures, tinted green / amber / red.
   - Status is a chip; the congestion ramp is deliberately *not* used here.
5. Change the **Status** filter to `charging` — the grid refetches server-side and
   the row count in the footer updates.
6. Set it to `retired` — the empty state appears and tells you what to do next,
   with a **Clear filters** button.
7. Hover any of the four dimmed rail icons — each says which sprint it arrives in.
8. **Sign out** → back to `/signin`. Reload the page: you stay signed out, because
   the access token only ever lived in memory.

To show the API directly:

```bash
TOKEN=$(curl -s -X POST localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@belagavi.local","password":"<printed password>"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['accessToken'])")

curl -s "localhost:4000/api/v1/vehicles?limit=2" -H "Authorization: Bearer $TOKEN"
curl -s "localhost:4000/api/v1/traffic/live"      -H "Authorization: Bearer $TOKEN"
curl -s "localhost:4000/api/v1/analytics/kpis"    -H "Authorization: Bearer $TOKEN"
curl -s "localhost:4000/api/v1/weather/current"   -H "Authorization: Bearer $TOKEN"
curl -s localhost:4000/readyz
```

---

## Scheduled work

`node-cron` runs inside the API process — there is no external scheduler, because this is a
single-process deployment by design.

| Job | Schedule | What it does |
|---|---|---|
| Traffic snapshot | every minute | Rolls the last 2 minutes of `traffic_readings` into `traffic_snapshots` |
| Weather poll | every 15 minutes | One reading per zone |
| Partition maintenance | 02:15 on the 1st | Keeps 3 months of partitions provisioned ahead |

Partition maintenance also runs on boot: a laptop switched off across a month boundary would
otherwise write everything into the `pmax` catch-all until the 1st.

Every job is wrapped so a failure logs and the schedule survives — a cron job that kills the API
at 02:00 is worse than one that skips a run. Jobs do not start under `NODE_ENV=test`, where a
cron firing mid-test would fight the truncate-and-reseed harness.

---

## Commands

```bash
# dev
npm run dev                  # both services
npm run dev:api              # Express only, :4000
npm run dev:web              # Vite only, :5173

# quality — all three must pass before work is done
npm run typecheck
npm run lint
npm run test

# database
npm run db:create
npm run db:migrate
npm run db:migrate:undo
npm run db:make -- add_station_occupancy_index
npm run db:seed
```

Migrations are **immutable once merged**. To change the schema, add a new migration — never edit
an applied one.

---

## Tests

```bash
npm run test
```

Integration tests run against `micromobility_test`, which must be migrated first:

```bash
NODE_ENV=test npm run db:migrate
```

Isolation differs by test type, for a reason recorded in
[`docs/adr/0001-test-isolation.md`](docs/adr/0001-test-isolation.md): HTTP tests truncate and
reseed between cases, because a Supertest request crosses a real socket and so cannot be enclosed
by a transaction opened in the test body. Direct service tests use transaction rollback.

The truncate helper refuses to run against any schema whose name does not end in `_test`, checked
both at import time and against the live connection. This machine's MySQL hosts several unrelated
project databases and a mistyped `.env` must not be able to wipe one.

---

## Project layout

```
apps/
  api/          Express service — the only writer to MySQL
    src/
      config/   env loading
      db/       migrations, models, seeders, spatial helper
      middleware/
      modules/  auth, users, admin, vehicles, ingest, health
      cache/    driver interface + memory driver
      jobs/     runner + inline worker_threads driver
      realtime/ event bus
      lib/      errors, envelope, cursor
    tests/      unit + integration
  web/          React SPA
    src/
      app/      router, providers, theme
      modules/  auth, fleet
      components/
      lib/      api client, query keys
      styles/   tokens.css, tailwind.css
packages/
  shared-types/ DTOs and envelopes shared by web and api
docs/
  design.md  MODULES.md  adr/  superpowers/
```

---

## Conventions worth knowing before you edit

- **MUI owns components, Tailwind owns layout.** Tailwind for flex/grid/gap/padding on plain
  wrappers; MUI `sx` or `styled()` inside MUI components. Reaching for `!important` means the
  component needs a theme override in `app/theme.ts` instead.
- **No hex values in components.** Colour comes from `styles/tokens.css` through the Tailwind
  config or the MUI theme.
- **The congestion ramp (`--flow-*`) is only for congestion.** Never a generic chart series.
- **Error handling switches on `error.code`, never `error.message`.** Codes are stable
  SCREAMING_SNAKE strings; messages are for humans and can change.
- **Controllers read `req.valid`, not `req.body`.** Every route parses with zod at the boundary.
- **Business logic lives in services**, not in route files or React components.
