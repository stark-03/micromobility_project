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

**Sprint 1** — foundation, authentication and the vehicle registry.

| Included | Not yet |
|---|---|
| npm-workspaces monorepo (`apps/web`, `apps/api`, `packages/shared-types`) | Traffic ingest, live map (Sprint 2) |
| 16-table MySQL schema with umzug migrations | Weather monitoring (Sprint 2) |
| Idempotent synthetic Belagavi seed | Route planning, A\* (Sprint 3) |
| M01 User & Access Management | ML service, demand model (Sprint 3) |
| M03 Vehicle Management + status state machine | Simulation engine (Sprint 4) |
| Cache / job-runner / event-bus adapter shells | Fleet optimization, analytics (Sprint 5) |
| Sign-in and Fleet screens | Payments, GBFS, emergency response (Sprint 6) |

The icon rail shows all six destinations; the five not yet built are disabled and say which
sprint they arrive in.

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
- **`allowPublicKeyRetrieval` is set for local development.** Over a plain localhost connection,
  `mysql2` needs the server's RSA public key for the first password exchange. It is set in
  `apps/api/src/db/index.ts`. **Never set it against a remote server** — use TLS there.

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
