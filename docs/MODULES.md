# AI Urban Micro Mobility Simulator — Module Specification

Derived from the project report (Ch. 1.3 Major Modules, Ch. 4 Methodology, Ch. 5 Requirements).
Stack: **React + Express + Node + MySQL (MERN-M)**, Tailwind CSS + Material UI on the frontend,
Python FastAPI sidecar for ML and simulation.

---

## 0. Module map

| # | Module | Owner service | Phase |
|---|--------|---------------|-------|
| M01 | User & Access Management | api | MVP |
| M02 | Traffic Monitoring | api + ingest | MVP |
| M03 | Vehicle Management | api | MVP |
| M04 | Route Planning | api + ml | MVP |
| M05 | AI Prediction | ml | MVP |
| M06 | Simulation Engine | ml (sim worker) | MVP |
| M07 | Fleet Optimization | ml | Phase 2 |
| M08 | Parking & Docking | api | Phase 2 |
| M09 | Safety & Risk Analysis | ml | Phase 2 |
| M10 | Environmental Analysis | api | Phase 2 |
| M11 | Data Analytics & Reporting | api | MVP (basic) |
| M12 | Weather Monitoring | ingest | MVP |
| M13 | Communication & Notifications | api (realtime) | Phase 2 |
| M14 | Payment & Billing | api | Phase 3 |
| M15 | Smart City Integration | api (adapters) | Phase 3 |
| M16 | Emergency Response | api | Phase 3 |

Roles referenced throughout: `admin`, `planner`, `operator`, `commuter`, `analyst`, `device`.

---

## M01 — User & Access Management

**Purpose.** Registration, login, profiles, travel history, preferences, role-based access.

**Responsibilities**
- Email/password auth with bcrypt; JWT access token (15 min) + rotating refresh token (7 days) in an httpOnly cookie.
- RBAC: a user holds one or more roles; every route declares required roles.
- Profile, saved places, preferred vehicle type, language, units.
- Device/API-key identities for data providers (IoT gateways) — no password, scoped keys.

**Tables**
`users`, `roles`, `user_roles`, `refresh_tokens`, `user_preferences`, `saved_places`, `api_keys`, `audit_logs`

**API**
```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/users/me
PATCH  /api/v1/users/me
GET    /api/v1/users/me/trips            # travel history
GET    /api/v1/admin/users               # admin, paginated
PATCH  /api/v1/admin/users/:id/roles
POST   /api/v1/admin/api-keys
```

**Screens.** Sign in, Sign up, Profile, Preferences, Admin → Users & Roles.

---

## M02 — Traffic Monitoring

**Purpose.** Ingest and expose live traffic state from GPS, IoT sensors and camera counters.

**Responsibilities**
- Batch ingest endpoint for devices (`device` role, API key auth), validated and rate-limited.
- Normalize readings onto `road_segments`; compute rolling occupancy, mean speed, congestion index (0–1).
- Publish `traffic:update` over Socket.IO to subscribed zone rooms.
- Cache the current city snapshot via the cache adapter (`traffic:snapshot:<zoneId>`, 15 s TTL).

**Tables**
`road_segments`, `zones`, `traffic_readings` (append-only, partitioned by month), `traffic_snapshots`

**API**
```
POST   /api/v1/ingest/traffic            # device only, array of readings
GET    /api/v1/traffic/live?zoneId=
GET    /api/v1/traffic/segments/:id/history?from=&to=&bucket=5m
GET    /api/v1/traffic/heatmap?bbox=&at=
WS     traffic:update
```

**Screens.** Live Map, Congestion Heatmap, Segment detail drawer.

---

## M03 — Vehicle Management

**Purpose.** Registry and live state of e-scooters, bicycles, e-bikes and shared EVs.

**Responsibilities**
- CRUD on vehicles; each belongs to an operator and a home zone.
- Lifecycle state machine: `available → reserved → in_use → returning → charging → maintenance → retired`.
- Telemetry: location, speed, battery %, odometer, lock state, fault codes.
- Battery thresholds trigger swap/charge tasks (feeds M07).

**Tables**
`operators`, `vehicles`, `vehicle_telemetry`, `vehicle_status_history`, `maintenance_tickets`

**API**
```
GET    /api/v1/vehicles?zoneId=&status=&type=
POST   /api/v1/vehicles                  # operator/admin
PATCH  /api/v1/vehicles/:id
GET    /api/v1/vehicles/:id/telemetry?from=&to=
POST   /api/v1/ingest/telemetry          # device only
POST   /api/v1/vehicles/:id/maintenance
WS     vehicle:moved, vehicle:status
```

**Screens.** Fleet table, Vehicle detail, Maintenance queue, Battery watchlist.

---

## M04 — Route Planning

**Purpose.** Shortest / safest / least-congested route for a micro mobility trip.

**Responsibilities**
- Graph over `road_segments` with per-edge cost = `f(distance, congestion, safety_score, gradient, mode)`.
- Three profiles: `fastest`, `safest`, `greenest`. Weights configurable per profile.
- A* in the ML service (NetworkX) with live congestion injected from the cache; Express caches results 60 s.
- Returns geometry, ETA, distance, elevation gain, estimated energy use, risk score.

**Tables**
`road_segments`, `route_cache`, `trip_plans`

**API**
```
POST   /api/v1/routes/plan               # {origin, destination, mode, profile}
GET    /api/v1/routes/:planId
POST   /api/v1/routes/compare            # returns all three profiles
```

**Screens.** Plan a Trip, Route comparison panel, Turn list.

---

## M05 — AI Prediction

**Purpose.** Forecast demand, congestion and anomalies.

**Responsibilities**
- **Demand model** — per zone, per 15 min horizon (1 h / 6 h / 24 h). Gradient boosting baseline (LightGBM), LSTM variant for comparison. Features: lag counts, hour-of-week, weather, holiday flag, zone population index.
- **Congestion model** — per segment, 30 min horizon.
- **Anomaly detection** — z-score on residuals; flags incidents for M09/M16.
- Model registry with versions, metrics (MAE / RMSE / MAPE) and an active flag; retraining is a scheduled job, never inline with a request.

**Tables**
`demand_forecasts`, `congestion_forecasts`, `model_registry`, `model_runs`, `feature_snapshots`

**API (ML service, called by Express only)**
```
POST   /internal/ml/predict/demand
POST   /internal/ml/predict/congestion
POST   /internal/ml/train                # async, returns jobId
GET    /internal/ml/models
```
**Public passthrough**
```
GET    /api/v1/predictions/demand?zoneId=&horizon=
GET    /api/v1/predictions/congestion?segmentId=
```

**Screens.** Forecast dashboard (actual vs predicted), Model registry (analyst).

---

## M06 — Simulation Engine

**Purpose.** Virtual city where scenarios run without touching real operations.

**Responsibilities**
- Scenario definition: city graph snapshot, fleet size and mix, demand profile (real or synthetic), weather, events, closures, policy levers (bike lanes, pricing, dock capacity).
- Agent-based tick loop (1 s sim-step, configurable speed-up): riders spawn, request vehicle, ride, park.
- Runs as a background job (job runner → Python worker); progress streamed over WebSocket.
- Deterministic seeds so a run is reproducible; results persisted for side-by-side comparison.

**Outputs per run.** Trips served / unserved, mean wait, mean trip time, vehicle utilization, distance travelled empty vs loaded, congestion delta, emissions avoided, safety incidents.

**Tables**
`scenarios`, `simulation_runs`, `simulation_metrics`, `simulation_events`, `scenario_comparisons`

**API**
```
POST   /api/v1/scenarios
GET    /api/v1/scenarios
POST   /api/v1/scenarios/:id/runs        # queue a run
GET    /api/v1/runs/:runId               # status + metrics
GET    /api/v1/runs/:runId/timeline
POST   /api/v1/runs/compare              # {runIds:[]}
WS     run:progress, run:completed
```

**Screens.** Scenario builder (wizard), Run monitor, Results, Compare runs.

---

## M07 — Fleet Optimization

**Purpose.** Decide where vehicles should be, and generate rebalancing work.

**Responsibilities**
- Compare predicted demand (M05) against current supply per zone; compute surplus/deficit.
- Solve rebalancing as a min-cost transportation problem (SciPy / OR-Tools) under van capacity and shift-hour constraints.
- Emit ordered pickup/drop tasks for operator crews; track completion.
- Charging plan: pick low-battery units whose removal costs the least availability.

**Tables**
`zone_supply_snapshots`, `rebalance_plans`, `rebalance_tasks`, `charging_tasks`

**API**
```
POST   /api/v1/fleet/rebalance/plan      # {zoneIds, horizon, vanCount}
GET    /api/v1/fleet/rebalance/plans/:id
PATCH  /api/v1/fleet/rebalance/tasks/:id # {status}
GET    /api/v1/fleet/supply-demand?zoneId=
```

**Screens.** Rebalance planner (map + task list), Crew task view (mobile-first).

---

## M08 — Parking & Docking

**Purpose.** Parking zones, docking stations, availability, and no-park geofences.

**Responsibilities**
- Station registry with capacity and live occupancy; virtual (geofenced) parking areas.
- Nearest-available-parking lookup at trip end; block trip end inside a no-park polygon.
- Occupancy forecast reuses the M05 demand pipeline at station granularity.

**Tables**
`stations`, `station_occupancy`, `parking_zones` (polygon), `no_park_zones`, `parking_events`

**API**
```
GET    /api/v1/parking/stations?near=lat,lng&radius=
GET    /api/v1/parking/stations/:id/availability
POST   /api/v1/parking/validate          # {vehicleId, lat, lng} → allowed | reason
GET    /api/v1/parking/forecast?stationId=
```

**Screens.** Parking layer on map, Station detail, Geofence editor (planner).

---

## M09 — Safety & Risk Analysis

**Purpose.** Find accident-prone areas and risky conditions; score segments for M04.

**Responsibilities**
- Kernel-density clustering of historical incidents → risk zones.
- Per-segment `safety_score` (0–100) from incident rate, lighting, lane type, speed differential, weather.
- Hard-braking / swerve / fall detection from telemetry; near-miss counting.
- Feeds route costs and planner reports.

**Tables**
`incidents`, `safety_events`, `risk_zones`, `segment_safety_scores`

**API**
```
GET    /api/v1/safety/risk-zones?bbox=
GET    /api/v1/safety/segments/:id/score
POST   /api/v1/safety/incidents          # operator/device
GET    /api/v1/safety/report?zoneId=&from=&to=
```

**Screens.** Risk map, Incident log, Safety report.

---

## M10 — Environmental Analysis

**Purpose.** Quantify energy use and emissions avoided.

**Responsibilities**
- Per trip: energy (Wh) from distance, mode, gradient, load; CO₂e avoided against a car-baseline factor per km (configurable, cited in `config/emission_factors.json`).
- Aggregate to zone / operator / city per day.
- Scenario-level totals for M06 comparison.

**Tables**
`emission_factors`, `trip_energy`, `emission_daily_rollups`

**API**
```
GET    /api/v1/environment/summary?scope=city|zone|operator&from=&to=
GET    /api/v1/environment/trips/:tripId
```

**Screens.** Sustainability dashboard, Emissions card on scenario results.

---

## M11 — Data Analytics & Reporting

**Purpose.** Dashboards, heat maps, charts, exports.

**Responsibilities**
- Aggregation endpoints backed by nightly rollup tables — never `GROUP BY` over raw telemetry at request time.
- Saved reports with parameters; CSV and PDF export.
- KPI set: trips/day, modal split, utilization, mean wait, congestion index, incidents per 10k km, CO₂e avoided.

**Tables**
`kpi_daily`, `zone_daily_rollups`, `reports`, `report_runs`

**API**
```
GET    /api/v1/analytics/kpis?from=&to=&zoneId=
GET    /api/v1/analytics/timeseries?metric=&bucket=
POST   /api/v1/reports
GET    /api/v1/reports/:id/export?format=csv|pdf
```

**Screens.** Overview dashboard, Explore (metric + breakdown pickers), Reports.

---

## M12 — Weather Monitoring

**Purpose.** Weather as a first-class model feature and simulation input.

**Responsibilities**
- Poll a weather API per zone every 15 min; store temp, precipitation, wind, visibility, condition code.
- Backfill history for training; expose forecast for scenario setup.
- Surface a ridership-impact hint (e.g. heavy rain → demand multiplier from the fitted model, not a hardcoded number).

**Tables**
`weather_readings`, `weather_forecasts`

**API**
```
GET    /api/v1/weather/current?zoneId=
GET    /api/v1/weather/forecast?zoneId=&hours=
```

**Screens.** Weather strip in the map header, Weather selector in the scenario builder.

---

## M13 — Communication & Notifications

**Purpose.** Move events between users, vehicles, servers and city infrastructure.

**Responsibilities**
- Socket.IO gateway with rooms: `zone:<id>`, `run:<id>`, `user:<id>`, `operator:<id>`.
- Notification records with channels: in-app, email; per-user quiet hours and category opt-outs.
- In-process event bus (`realtime/bus.ts`) so ingest workers fan out without touching sockets
  directly. Swaps to Redis pub/sub only when the API runs on more than one process.

**Tables**
`notifications`, `notification_preferences`, `device_tokens`

**API**
```
GET    /api/v1/notifications?unread=true
PATCH  /api/v1/notifications/:id/read
PATCH  /api/v1/notifications/preferences
WS     notification:new
```

**Screens.** Notification drawer, Preferences.

---

## M14 — Payment & Billing

**Purpose.** Ride charges, subscriptions, invoices. *Simulated by default.*

**Responsibilities**
- Pricing plans: unlock fee + per-minute rate, or pass/subscription; per operator, per vehicle type.
- Fare computed at trip end; wallet ledger with double-entry style entries (`debit`/`credit`) so balances always reconcile.
- Payment provider behind an adapter interface. Ship a `MockGateway`; a real gateway is a config swap. **Never store card data.**

**Tables**
`pricing_plans`, `subscriptions`, `fares`, `wallet_accounts`, `wallet_transactions`, `invoices`, `payment_intents`

**API**
```
GET    /api/v1/billing/plans
POST   /api/v1/billing/subscribe
GET    /api/v1/billing/wallet
POST   /api/v1/billing/topup
GET    /api/v1/billing/invoices
```

**Screens.** Wallet, Plans, Ride receipts, Operator revenue view.

---

## M15 — Smart City Integration

**Purpose.** Adapters to external city systems.

**Responsibilities**
- Adapter pattern, one folder per integration, all behind a common `CityAdapter` interface: `fetch()`, `push()`, `healthCheck()`.
- Planned adapters: GBFS feed (in/out), traffic signal API (read phase, propose timing), public transport GTFS for multimodal legs, open data portal export.
- Outbound GBFS publisher so this project's fleet is consumable by third parties.
- Circuit breaker + retry with backoff; every call logged to `integration_logs`.

**Tables**
`integrations`, `integration_logs`, `external_feed_cache`

**API**
```
GET    /api/v1/integrations
POST   /api/v1/integrations/:id/sync
GET    /gbfs/2.3/gbfs.json               # public, unauthenticated
GET    /gbfs/2.3/free_bike_status.json
```

**Screens.** Integrations admin (status, last sync, error log).

---

## M16 — Emergency Response

**Purpose.** Handle accidents, breakdowns and disruptions.

**Responsibilities**
- SOS from a rider's active trip; crash signature from telemetry auto-raises an alert.
- Alert lifecycle: `open → acknowledged → dispatched → resolved`, with assignee and timestamps.
- Auto-actions: mark vehicle `maintenance`, notify operator on-call, push a reroute advisory to riders in the affected segment.
- Disruption broadcast (closure, event) that the simulator and router both respect.

**Tables**
`emergency_alerts`, `alert_assignments`, `disruptions`, `disruption_effects`

**API**
```
POST   /api/v1/emergency/sos             # commuter, from active trip
GET    /api/v1/emergency/alerts?status=
PATCH  /api/v1/emergency/alerts/:id
POST   /api/v1/emergency/disruptions     # planner/operator
WS     emergency:alert
```

**Screens.** Alert console (operator), SOS button in ride view, Disruption banner.

---

## Cross-module data flow

```
devices ──▶ M02/M03 ingest ──▶ MySQL raw tables ──▶ nightly rollups ──▶ M11
                 │                                        │
                 └──▶ cache snapshot ──▶ M04 routing     └──▶ M05 features ──▶ forecasts
                                                                    │
M12 weather ────────────────────────────────────────────────────────┤
                                                                    ▼
                                              M06 simulation ──▶ M07 rebalance plans
                                                    │
                                                    └──▶ M10 emissions, M09 safety deltas
```

## Build order

1. **Sprint 1** — M01, skeleton app shell, MySQL schema + seed city (Belagavi grid), M03 registry.
2. **Sprint 2** — M02 ingest + live map, M12 weather, M11 basic KPIs.
3. **Sprint 3** — M04 routing, M05 demand model v1.
4. **Sprint 4** — M06 simulation engine + scenario builder + results.
5. **Sprint 5** — M07, M08, M09, M10.
6. **Sprint 6** — M13, M14, M15, M16, hardening.
