# Design Document — AI Urban Micro Mobility Simulator

Version 1.0 · Dept. of CSE, AITM, Belagavi
Companion documents: `MODULES.md` (module contracts), `CLAUDE.md` (working conventions)

---

## 1. Design goals

1. **Simulation first.** Every policy lever a planner can pull in the real city must be
   expressible as a scenario parameter and comparable against a baseline run.
2. **Live and historical share one path.** The router, the forecaster and the simulator read the
   same graph and the same feature definitions, so a simulated result is comparable to a
   measured one.
3. **Relational integrity.** Trips, fares, vehicles and incidents are transactional records with
   real constraints — hence MySQL, not a document store.
4. **Readable under load.** A planner looking at a congested city at 6 pm needs the interface to
   stay legible. Density is the design problem, not decoration.
5. **Honest about uncertainty.** Forecasts ship with intervals and model version, never a bare
   number.

## 2. System architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Clients                                                           │
│  React SPA (planner / operator / analyst)   ·   Commuter web app   │
└───────────────┬────────────────────────────────────┬───────────────┘
                │ HTTPS (REST)                       │ WSS (Socket.IO)
┌───────────────▼────────────────────────────────────▼───────────────┐
│  Express API (Node 22 LTS)                                          │
│  ┌──────────┬──────────┬───────────┬──────────┬─────────────────┐  │
│  │ auth/rbac│ validate │ modules   │ realtime │ job producers   │  │
│  │ (zod)    │          │ M01…M16   │ gateway  │ (job runner)    │  │
│  └──────────┴──────────┴─────┬─────┴──────────┴────────┬────────┘  │
└──────────────┬───────────────┼─────────────────────────┼───────────┘
               │               │ internal HTTP           │
     ┌─────────▼─────┐  ┌──────▼──────────────┐   ┌──────▼────────┐
     │  MySQL 8.4    │  │  FastAPI ML service │   │ In-process    │
     │  (local       │  │  Python 3.13 venv   │   │ cache · event │
     │   install)    │  │  routing (A*)       │   │ bus · job     │
     │  spatial idx  │  │  simulation (SimPy) │   │ runner        │
     │               │  │                     │   └──────┬────────┘
     └───────────────┘  └─────────┬───────────┘          │
                                  │                ┌─────▼─────────┐
     ┌────────────────────────────▼─────┐          │ Workers       │
     │ Ingest workers                   │          │ sim runs,     │
     │ GPS · IoT · cameras · weather API│          │ training,     │
     └──────────────────────────────────┘          │ rollups       │
                                                   └───────────────┘
```

### Why three services
- **Express** owns identity, transactions and the public contract. It is the only writer to MySQL.
- **FastAPI** owns everything numeric — models, graph search, the simulation loop. It is stateless
  and horizontally scalable; it receives the snapshot it needs in the request payload and returns
  results. It has no database credentials.
- **Workers** run anything longer than a request: simulation runs, retraining, nightly rollups,
  partition maintenance, weather polling.

### Request paths

**Live map load**
`GET /traffic/live` → cache hit (`traffic:snapshot:<zoneId>`, 15 s TTL) → return. On miss, aggregate the last
2 minutes of `traffic_readings` per segment, write snapshot, return.

**Route plan**
`POST /routes/plan` → Express validates → checks `route_cache` (60 s) → ML `/internal/routing/plan`
with live congestion read from the cache → persist to `trip_plans` → return geometry + ETA + risk score.

**Simulation run**
`POST /scenarios/:id/runs` → row in `simulation_runs` (`queued`) → job runner → Python worker
loads the scenario, ticks the clock, emits progress to the event bus every 100 sim-steps → gateway
relays to `run:<id>` → worker writes `simulation_metrics` → status `completed`.

## 3. Data model

### 3.1 Core entities

```
users ──< user_roles >── roles
  │
  ├──< trips >── vehicles ──> operators
  │      │           │
  │      │           └──< vehicle_telemetry
  │      ├──< trip_energy ──> emission_factors
  │      └──> fares ──> wallet_transactions
  │
  └──< notifications

zones ──< road_segments ──< traffic_readings
  │            │
  │            ├──< segment_safety_scores
  │            └──< congestion_forecasts
  ├──< stations ──< station_occupancy
  ├──< demand_forecasts
  └──< weather_readings

scenarios ──< simulation_runs ──< simulation_metrics
                    └──< simulation_events

incidents ──> risk_zones          emergency_alerts ──> disruptions
```

### 3.2 Representative DDL

```sql
CREATE TABLE zones (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120)      NOT NULL,
  code          VARCHAR(32)       NOT NULL UNIQUE,
  boundary      POLYGON           NOT NULL SRID 4326,
  centroid      POINT             NOT NULL SRID 4326,
  population_ix DECIMAL(6,3)      NULL,
  created_at    DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                  ON UPDATE CURRENT_TIMESTAMP(3),
  SPATIAL INDEX idx_zones_boundary (boundary)
) ENGINE=InnoDB;

CREATE TABLE vehicles (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  operator_id   BIGINT UNSIGNED   NOT NULL,
  home_zone_id  BIGINT UNSIGNED   NULL,
  external_ref  VARCHAR(64)       NOT NULL,
  type          ENUM('scooter','bike','ebike','ev')      NOT NULL,
  status        ENUM('available','reserved','in_use','returning',
                     'charging','maintenance','retired')  NOT NULL DEFAULT 'available',
  battery_pct   TINYINT UNSIGNED  NULL,
  last_seen_at  DATETIME(3)       NULL,
  last_position POINT             NULL SRID 4326,
  deleted_at    DATETIME(3)       NULL,
  created_at    DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                  ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_vehicle_ref (operator_id, external_ref),
  KEY idx_vehicles_status_zone (status, home_zone_id),
  CONSTRAINT fk_vehicles_operator FOREIGN KEY (operator_id) REFERENCES operators(id),
  CONSTRAINT fk_vehicles_zone     FOREIGN KEY (home_zone_id) REFERENCES zones(id)
) ENGINE=InnoDB;

CREATE TABLE traffic_readings (
  id            BIGINT UNSIGNED AUTO_INCREMENT,
  segment_id    BIGINT UNSIGNED   NOT NULL,
  observed_at   DATETIME(3)       NOT NULL,
  mean_speed_kph DECIMAL(6,2)     NULL,
  vehicle_count SMALLINT UNSIGNED NULL,
  occupancy     DECIMAL(5,4)      NULL,
  source        ENUM('gps','sensor','camera','synthetic') NOT NULL,
  PRIMARY KEY (id, observed_at),
  KEY idx_tr_segment_time (segment_id, observed_at)
) ENGINE=InnoDB
PARTITION BY RANGE (TO_DAYS(observed_at)) (
  PARTITION p2026_08 VALUES LESS THAN (TO_DAYS('2026-09-01')),
  PARTITION pmax     VALUES LESS THAN MAXVALUE
);

CREATE TABLE simulation_runs (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scenario_id   BIGINT UNSIGNED   NOT NULL,
  seed          INT UNSIGNED      NOT NULL,
  status        ENUM('queued','running','completed','failed') NOT NULL DEFAULT 'queued',
  started_at    DATETIME(3)       NULL,
  finished_at   DATETIME(3)       NULL,
  model_version VARCHAR(64)       NULL,
  error         TEXT              NULL,
  created_by    BIGINT UNSIGNED   NOT NULL,
  created_at    DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_runs_scenario_status (scenario_id, status),
  CONSTRAINT fk_runs_scenario FOREIGN KEY (scenario_id) REFERENCES scenarios(id)
) ENGINE=InnoDB;
```

### 3.3 Aggregation strategy
Raw telemetry is written once and never scanned by the UI. Nightly workers build
`zone_daily_rollups` and `kpi_daily`; a 5-minute worker maintains `traffic_snapshots`.
Dashboards read rollups only. This keeps p95 dashboard latency under 400 ms on a laptop-class
MySQL instance.

## 4. AI/ML design

| Model | Task | Baseline | Target metric |
|---|---|---|---|
| Demand | trips per zone per 15 min | seasonal-naïve (same slot last week) | MAE ≤ 0.7× baseline |
| Congestion | segment speed, 30 min ahead | last-observed | RMSE ≤ 0.75× baseline |
| Anomaly | incident flag from residuals | 3σ threshold | PR-AUC ≥ 0.6 |
| Rebalance | min-cost supply→demand transport | none (proportional split) | unserved trips ↓ ≥ 15% in sim |

Feature set (shared by training and inference, defined once in `ml/app/features.py`):
lagged counts (1, 2, 4, 24, 168 slots), hour-of-week cyclic encoding, holiday flag, precipitation,
temperature, wind, zone population index, station capacity, active disruptions.

Guarding against leakage: splits are chronological, never random. The evaluation harness refuses
a split where the validation window precedes any training timestamp.

Routing cost per edge:
```
cost = w_d·(length/speed_free) + w_c·congestion_delay + w_s·(1 - safety_score/100) + w_g·gradient_penalty
```
Profiles set the weights: `fastest` (1.0, 1.0, 0.1, 0.2), `safest` (1.0, 0.6, 1.2, 0.3),
`greenest` (0.8, 0.5, 0.5, 0.9). Weights live in config, not code.

## 5. Simulation design

- **Clock.** Discrete event loop over 1-second steps, default 24 sim-hours per run.
- **Agents.** Riders (spawn from a demand profile, walk to a vehicle within radius `r`, ride,
  park), Vehicles (battery drain per km by type), Rebalance vans (execute M07 tasks).
- **World.** Snapshot of `road_segments` with per-slot congestion from either replay of a real
  day or a forecast, plus scenario overrides (closures, new lanes, dock changes).
- **Determinism.** One seeded RNG passed down; no module calls `random` directly. A regression
  test asserts identical metrics across two runs with the same seed.
- **Comparison.** Every scenario has a `baseline_run_id`; results are shown as deltas with the
  absolute value secondary, because the delta is what a planner acts on.

## 6. Interface design

### 6.1 Direction — "wayfinding"

The subject's own visual vernacular is transit wayfinding: route diagrams, station dots, line
colors, legend keys. That is where this interface takes its identity. The city is drawn as a
network of lines; every list, timeline and process view reuses the same line-and-node grammar
that the map uses. A planner scanning a route on the map and then reading a trip's stop sequence
in a table should feel the same system.

Ground: deep ink, because the product's centre of gravity is a dark map and everything must sit
on it without a jarring switch. A light "paper" theme exists for printed reports.

### 6.2 Tokens

```css
/* styles/tokens.css — single source of truth for MUI theme AND tailwind.config.js */
:root {
  /* ground */
  --ink-950:  #070B14;   /* app background */
  --ink-900:  #0D1424;   /* surface */
  --ink-800:  #16203A;   /* raised surface, cards */
  --ink-700:  #223052;   /* borders, dividers */
  --mist-400: #8095B8;   /* secondary text */
  --mist-100: #E6EDF8;   /* primary text */

  /* line colors — one per mode, used on map and in every legend */
  --line-scooter: #F2A20C;
  --line-bike:    #00B3A4;
  --line-ebike:   #7C5CFF;
  --line-ev:      #4D8DF7;

  /* congestion ramp — free → jammed, used ONLY for congestion */
  --flow-0: #3DD68C;
  --flow-1: #C9D93B;
  --flow-2: #F2C94C;
  --flow-3: #F2762E;
  --flow-4: #E5484D;

  /* status */
  --ok: #3DD68C;  --warn: #F2C94C;  --danger: #E5484D;  --info: #4D8DF7;

  /* type */
  --font-display: 'Archivo', system-ui, sans-serif;   /* 600/700, tight tracking */
  --font-body:    'Inter', system-ui, sans-serif;
  --font-mono:    'IBM Plex Mono', ui-monospace, monospace;

  /* rhythm */
  --r-sm: 4px; --r-md: 8px; --r-lg: 14px;
  --shadow-card: 0 1px 0 rgba(255,255,255,.04), 0 8px 24px rgba(0,0,0,.45);
}
```

Rules that keep it disciplined:
- The congestion ramp is reserved for congestion. Never use `--flow-*` for a generic chart series.
- Mode colors are constant everywhere — map polyline, legend chip, chart series, table dot.
- One accent per screen. If two things are competing for attention, one of them isn't important.

### 6.3 Typography

| Role | Face | Setting |
|---|---|---|
| Display / page titles | Archivo 700 | `-0.02em` tracking, 28–40px |
| Section headers | Archivo 600 | uppercase, `0.08em`, 12px — reads as signage |
| Body | Inter 400/500 | 14/15px, 1.55 line height |
| Data, IDs, coordinates, timers | IBM Plex Mono 400 | tabular figures, always |

Any number that changes in place — ETA, battery %, live counts — is mono with tabular figures so
it doesn't jitter.

### 6.4 Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ ▍AI URBAN MICRO MOBILITY   │ Zone ▾  │ 05 Aug 18:24 │ ☂ 24°C │ ⚑ 3  │  top bar 56px
├────────┬─────────────────────────────────────────────────────────────┤
│        │                                                             │
│  rail  │                    MAP CANVAS                               │
│  64px  │                                                             │
│  ▣ Live│        ● ── ● ── ● ── ●   route line, station nodes         │
│  ◈ Plan│                                                             │
│  ⬡ Sim │   ┌──────────────┐                    ┌──────────────────┐  │
│  ⬢ Fleet│  │ LEGEND / KEY │                    │  CONTEXT PANEL   │  │
│  ◷ Data │  │ ● scooter    │                    │  selected entity │  │
│  ⚙ Admin│  │ ● bike       │                    │  or scenario form│  │
│        │   │ flow ▁▂▃▅▇   │                    │  380px, dockable │  │
│        │   └──────────────┘                    └──────────────────┘  │
└────────┴─────────────────────────────────────────────────────────────┘
```

- Map is the ground plane on Live, Plan and Sim. Data-heavy screens (Fleet, Analytics, Admin)
  drop the map for a full-width table/dashboard.
- The **legend is permanent**, not a tooltip. A map with five encodings and a hidden key is
  unreadable, and the legend is the signature element: a fixed key card with the mode dots and
  the congestion ramp, always bottom-left, in the same position on every screen that draws data.
- Context panel slides from the right and never covers more than a third of the canvas.

### 6.5 Component decisions

| Need | Component |
|---|---|
| Tables (fleet, users, tasks) | MUI `DataGrid` — column pinning, virtualization |
| Forms (scenario builder) | MUI + `react-hook-form` + zod resolver, stepped `Stepper` |
| Time range | MUI `DateTimePicker` with preset chips (1h / 24h / 7d / 30d) |
| Metric cards | custom, Tailwind layout + mono value + sparkline |
| Charts | Recharts, themed from tokens, no default palette |
| Toasts | `notistack`, top-right, 4 s, never for errors that need an action |

### 6.6 Screen inventory

1. **Live** — map, congestion ramp, vehicle dots, incident pins, KPI strip.
2. **Plan a trip** — origin/destination, three route profiles side by side with ETA, risk, energy.
3. **Scenario builder** — 4-step wizard: city & window → fleet mix → demand & weather → policy levers.
4. **Run monitor** — progress bar tied to sim clock, live metric tickers, event feed.
5. **Results & compare** — delta cards vs baseline, small-multiples by zone, export.
6. **Fleet** — DataGrid, battery watchlist, rebalance planner with map + ordered task list.
7. **Analytics** — KPI grid, metric explorer, saved reports.
8. **Safety** — risk map, incident log, segment score detail.
9. **Sustainability** — energy and CO₂e avoided, per zone and per operator.
10. **Admin** — users & roles, integrations, data sources, model registry, audit log.

### 6.7 Interaction and quality floor

- Motion is functional only: map fly-to on selection (400 ms ease-out), panel slide (200 ms),
  simulation tick interpolation. Nothing decorative. `prefers-reduced-motion` disables all of it
  and jumps to the end state.
- Live values update at most once per second and animate the digit, not the layout.
- Keyboard: `⌘K` command palette, `/` focuses search, `Esc` closes the context panel, arrow keys
  move between map selections. Visible focus rings everywhere, 2px `--info`.
- Contrast: body text on `--ink-900` clears 7:1; mode colors are used as fills next to a text
  label, never as the only carrier of meaning.
- Responsive: below 1024px the rail collapses to icons and the context panel becomes a bottom
  sheet. Crew task views are designed mobile-first because that's where they're used.

### 6.8 Tailwind + MUI integration

```js
// tailwind.config.js
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },        // MUI CssBaseline owns the reset
  theme: {
    extend: {
      colors: {
        ink:  { 950:'var(--ink-950)', 900:'var(--ink-900)', 800:'var(--ink-800)', 700:'var(--ink-700)' },
        mist: { 400:'var(--mist-400)', 100:'var(--mist-100)' },
        line: { scooter:'var(--line-scooter)', bike:'var(--line-bike)',
                ebike:'var(--line-ebike)', ev:'var(--line-ev)' },
        flow: { 0:'var(--flow-0)', 1:'var(--flow-1)', 2:'var(--flow-2)',
                3:'var(--flow-3)', 4:'var(--flow-4)' },
      },
      fontFamily: {
        display: ['var(--font-display)'], sans: ['var(--font-body)'], mono: ['var(--font-mono)'],
      },
      borderRadius: { sm:'var(--r-sm)', md:'var(--r-md)', lg:'var(--r-lg)' },
    },
  },
};
```

```tsx
// app/theme.ts — MUI reads the same variables
export const theme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: 'var(--ink-950)', paper: 'var(--ink-800)' },
    text: { primary: 'var(--mist-100)', secondary: 'var(--mist-400)' },
    primary: { main: 'var(--info)' },
    error: { main: 'var(--danger)' },
    success: { main: 'var(--ok)' },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: 'var(--font-body)',
    h1: { fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '-0.02em' },
    overline: { fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '0.08em' },
  },
});

// main.tsx
<StyledEngineProvider injectFirst>
  <ThemeProvider theme={theme}><CssBaseline />…</ThemeProvider>
</StyledEngineProvider>
```

`injectFirst` puts MUI's styles before Tailwind's in the cascade, so a Tailwind utility on a
wrapper wins without `!important`. Component-level overrides still belong in the theme.

## 7. Security & privacy

- JWT access (15 min, memory only) + refresh (7 d, httpOnly + SameSite=Strict cookie, rotated on
  use, reuse detection revokes the family).
- RBAC enforced server-side on every route; the frontend hides UI it can't use but is never the
  gate.
- Rate limits: 100 req/min per user, 1000 req/min per device key, 10 login attempts per 15 min
  per IP.
- Ingest endpoints authenticate with scoped API keys and reject readings timestamped more than
  10 minutes in the future or 24 hours in the past.
- Trip geometry is stored against a pseudonymous `trip_id`; the `user_id` link is dropped from
  analytics tables. Zone breakdowns suppress cells with fewer than 5 trips.
- Helmet, CORS allowlist, parameterized queries only, zod validation at every boundary,
  `express-mysql-session` not used — sessions are JWT-only.

## 8. Performance targets

| Path | Target (p95) |
|---|---|
| `GET /traffic/live` | < 200 ms |
| `POST /routes/plan` | < 500 ms |
| Dashboard KPI load | < 400 ms |
| Telemetry ingest | 2,000 readings/s sustained |
| 24 sim-hour run, 500 vehicles | < 90 s |
| Initial JS bundle | < 250 KB gzipped (map + charts lazy-loaded) |

## 9. Testing

- **Unit** — fare calculation, edge cost function, state machine transitions, feature builder.
- **Integration** — Supertest against a local `micromobility_test` schema with migrations applied;
  each test runs in a transaction that rolls back.
- **ML** — leakage guard, chronological split assertion, metric floor gate in CI.
- **Simulation** — determinism test, conservation test (no vehicle exists in two places, no trip
  ends before it starts).
- **E2E** — Playwright: sign in → build scenario → run → read results → export.

## 10. Running the system

**Current (development, no containers).** MySQL 8.4.10, Node 22.23.1 and Python 3.13.11 installed
natively on the developer's machine.
Three processes started by hand or via `npm run dev`: Vite dev server (5173), Express API (4000),
FastAPI ML service (8000). Caching is in-process (`node-cache`), background jobs run inline on a
worker thread, scheduled work uses `node-cron` inside the API process. No Redis. Health endpoints
`/healthz` (liveness) and `/readyz` (MySQL + ML reachable) exist from day one.

This is a deliberate constraint, not a shortcut: with cache, queue and pub/sub behind driver
interfaces (`cache/index.ts`, `jobs/runner.ts`, `realtime/bus.ts`), the single-process build is
correct on its own terms and the distributed build is a config change.

**Later (shipping).** Adding Redis flips `CACHE_DRIVER=redis` and `QUEUE_DRIVER=bullmq`, moves
workers to separate processes, and swaps Socket.IO's adapter. Containerization, nginx TLS
termination and a nightly `mysqldump` + binlog backup schedule land at the same time. None of
that is built yet, and nothing in the codebase should assume it.

## 11. Open questions

1. Real city data for Belagavi, or synthetic generation from OSM + a gravity model? Synthetic is
   assumed for now; the ingest contract is identical either way.
2. Is SUMO worth integrating as an external microsimulator for validation, or is the in-house
   SimPy loop sufficient at this scope? Deferred to after Sprint 4.
3. Multilingual support (report §4.4 Step 1) — scope to English + Kannada + Hindi, i18next,
   strings extracted from day one.
