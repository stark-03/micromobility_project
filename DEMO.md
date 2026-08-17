# Demo runbook

One page. Everything needed to show this working, and what to do when something isn't.

---

## Before you leave the house

```bash
npm run demo:check
```

Checks MySQL, migrations, seed data, traffic, weather and the two ports — and prints the exact
fix for anything it finds. Run it once the night before and once again just before the viva.

---

## Start everything

```bash
npm run demo
```

One command, four processes: API on **:4000**, web on **:5173**, the ML routing service on
**:8000**, and the synthetic traffic generator ticking every 3 seconds pinned to evening rush.

The ML service runs in the `micromobility` conda environment (Python 3.12). If it fails to
start, everything except **Plan** and **Sim** still works — `/readyz` will say `ml: down` and the other
screens are unaffected.

> If port 5173 is taken, Vite will pick 5174 and say so — read the URL it prints.

Then open <http://localhost:5173>.

---

## Accounts

| Role | Email | Password |
|---|---|---|
| **admin** | `admin@belagavi.local` | `eQwwwt689EpL` |
| planner | `planner@belagavi.local` | `NhmHQJFEvGd0` |
| operator | `operator@belagavi.local` | `k1ENW4CMkiTw` |
| commuter | `commuter@belagavi.local` | `_jAA5bSnau6Y` |
| analyst | `analyst@belagavi.local` | `1MsgfscGgAXp` |

Use **admin** unless you are specifically demonstrating role restrictions.

---

## The five-minute path

1. **Sign in.** Type a wrong password first if you want to show error handling — the screen
   switches on the error *code*, never the message.

2. **Live map.** Eight Belagavi zones with labels, ~152 road segments coloured by congestion,
   permanent legend bottom-left, KPI strip on top, temperature in the header.
   - The colours shift every 3 seconds. The generator writes readings, a worker rolls them into
     `traffic_snapshots`, and the server pushes `traffic:update` over Socket.IO.
   - **Click a road** → context panel with congestion, mean speed, free-flow speed, length.
     The selected road thickens.
   - The network is **radial-concentric** — a centre, twelve radial arterials, four ring roads,
     and local streets filling the sectors — because that is how Belagavi actually grew.
   - The map is **SVG**, not WebGL. It needs no graphics driver, no worker and no network, so
     it renders in any browser including Brave with shields up. This is deliberate — see below.
   - **Interactive map (WebGL)** toggle switches to the MapLibre renderer, which adds pan, zoom
     and an optional OpenStreetMap basemap. Only use it if you have tested it on the demo
     machine; it needs WebGL enabled.

3. **Fleet.** 60 vehicles, two operators, eight zones. Mode dot beside each type, battery bar,
   status chip. Filter by status → server-side refetch, footer count updates. Filter to
   `retired` → empty state that tells you what to do, with a Clear filters button.

4. **Plan.** Pick a start and end zone, pick a mode, compare. Three routes are planned
   independently by A\* over the live road graph, with current congestion folded into every
   edge cost.
   - The three profiles weight time, safety and energy differently, and the cards show what
     each choice costs: `fastest` is quickest but climbs more and carries more risk; `safest`
     trades minutes for a lower risk score; `greenest` finds the route with least climbing.
   - Green figures mark the winner on each measure; the others show how far behind they are.
   - Each card lists its turn-by-turn roads, dotted by that road's congestion.
   - Worth saying: the search runs in a **separate Python service**. Express owns the data and
     the contract, FastAPI owns the numeric work, and it holds no database credentials — the
     subgraph travels in the request.

5. **Sim.** The module the project is named for — test a policy before the city builds it.
   - Four seeded scenarios. **Baseline** is the city as it runs today; each of the other three
     pulls exactly one lever, so any difference is attributable to that lever and nothing else.
   - Press **Run simulation**. A row is written as `queued`, a job runner hands it to a worker
     thread, the worker streams the run from the Python service, and progress arrives over the
     `run:<id>` socket room. A full simulated day finishes in about 200 ms.
   - Results: trips served, unmet demand, service rate, mean wait, utilisation, incident rate.
     Under them, **why** demand went unmet — on the seeded fleet it is `no charged vehicle`,
     not "not enough scooters". That is the kind of finding the module exists to produce.
   - **Compare against** another scenario for the headline result: protected bike lanes cut the
     incident rate ~31% while slightly *increasing* trips served. Deltas are labelled better or
     worse by metric, so fewer unserved trips reads as an improvement despite a negative sign.
   - Say the seed line out loud: same seed + same scenario = identical metrics, and there is a
     test asserting exactly that. A simulation you cannot reproduce is not evidence.

6. **Data.** The demand model, and the governance around it.
   - Headline tiles: the active model's MAE against the seasonal-naive baseline, and the skill
     ratio against design.md's 0.70 target.
   - The forecast chart shows predicted trips per 15-minute slot for one zone, with the 80%
     interval shaded. One zone at a time is deliberate — eight series would need a categorical
     colour scale the design system does not have.
   - **The registry is the interesting part.** It lists every fit, active or not. The first
     model scored 0.787, missed the target, and was recorded **Inactive** — design.md §4 says a
     model with no passing eval does not get an active flag, and the system enforced it rather
     than shipping the model anyway.

6. **The rail.** Two dimmed icons, each with a tooltip naming the sprint it arrives in. Say
   this out loud — it shows the roadmap is planned, not forgotten.

7. **Sign out**, then reload. You stay signed out: the access token only ever lived in memory.

---

## If you have longer

**Role-based access is real, not cosmetic.** Sign in as `commuter`:
- Fleet still lists vehicles (reads are open to any signed-in user)
- but `POST /vehicles` returns 403

Sign in as `operator` — they see only ~30 of the 60 vehicles, because they are scoped to
Belagavi Mobility Co-op.

**The API, from a terminal:**

```bash
TOKEN=$(curl -s -X POST localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@belagavi.local","password":"eQwwwt689EpL"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['accessToken'])")

curl -s localhost:4000/api/v1/traffic/live    -H "Authorization: Bearer $TOKEN" | head -c 400
curl -s localhost:4000/api/v1/analytics/kpis  -H "Authorization: Bearer $TOKEN"
curl -s localhost:4000/api/v1/weather/current -H "Authorization: Bearer $TOKEN"
curl -s localhost:4000/readyz
```

**The tests**, if asked how it is verified:

```bash
npm run typecheck && npm run lint && npm run test
conda activate micromobility && cd apps/ml && pytest -q && ruff check .
```

272 tests — 239 API, 33 frontend — plus 40 pytest cases in the ML service.

---

## When something breaks

| Symptom | Cause | Fix |
|---|---|---|
| Map is blank | No traffic data yet | `npm run demo:traffic` |
| Map blank only after toggling **Interactive map (WebGL)** | Browser has WebGL disabled | Toggle it back off — the SVG map is the default for exactly this reason |
| Map is all green | Off-peak in the diurnal curve | The `demo` script pins 18:30; if you ran `traffic:sim` bare, add `-- --hour 18.5` |
| Map shows a red "Map error" banner | MapLibre failed | Read the banner — it names the cause |
| `maplibre-gl-worker.mjs ... does not exist in the optimize deps directory` | Stale Vite dep cache | `rm -rf apps/web/node_modules/.vite` then restart |
| Roads grey, not coloured | Snapshots empty | `npm run demo:traffic`, wait one tick |
| "Could not reach the server" on sign-in | API not running | Check the `api` pane; `fuser -k 4000/tcp` then restart |
| Colours never change | Socket blocked | Harmless — the map also polls every 15s |
| `EADDRINUSE` | Stale process | `fuser -k 4000/tcp; fuser -k 5173/tcp` |
| `ER_NOT_SUPPORTED_AUTH_MODE` | Wrong MySQL driver | Must be `mysql2`; MySQL 8.4 removed `mysql_native_password` |
| **Plan** says the routing service is unreachable | uvicorn not running | `npm run dev:ml`, or check the `ml` pane |
| A run goes straight to **failed** | ML service down | Same fix — the error text on the run says which |
| A run sits at **queued** | socket did not connect | It still finishes; the list polls every 1.5 s and will catch up |
| **Data** shows no forecast | Model not trained, or no history | `npm run demand:backfill`, then **Retrain model** |
| Everything is broken | | `git checkout master` — Sprint 1 alone, fully tested, Fleet screen works |

---

## What to say about scope

Built: **M01** users and access, **M02** traffic monitoring, **M03** vehicle management,
**M04** route planning, **M05** demand prediction, **M06** simulation engine, **M11** basic KPIs,
**M12** weather. Eight of sixteen modules — Sprints 1 to 4 complete.

The count undersells it — those five include every piece of shared infrastructure the other
eleven stand on: the migration system, spatial handling, auth and RBAC, the cache/jobs/event-bus
adapters, the Socket.IO gateway, and the test harness.

Remaining: fleet optimisation and analysis (Sprint 5), then notifications, billing, GBFS and
emergency response (Sprint 6). M07 rebalancing has a placeholder in the simulator already — the
greedy surplus-to-deficit mover behind the rebalancing lever — so Sprint 5 replaces an
algorithm rather than building a subsystem.

Honest framing if asked why it isn't finished: the foundation is disproportionately expensive
and it is done. Sprint 3 onward adds features to a working system rather than building the
system.
