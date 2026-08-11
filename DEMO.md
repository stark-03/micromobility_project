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

One command, three processes: API on **:4000**, web on **:5173**, and the synthetic traffic
generator ticking every 3 seconds pinned to evening rush.

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

2. **Live map.** Eight Belagavi zones, 121 road segments coloured by congestion, permanent
   legend bottom-left, KPI strip on top, temperature in the header.
   - The colours shift every 3 seconds. The generator writes readings, a worker rolls them into
     `traffic_snapshots`, and the server pushes `traffic:update` over Socket.IO.
   - **Click a road** → context panel with congestion, mean speed, free-flow speed, length.
   - **Street basemap** toggle adds OpenStreetMap underneath. Leave it **off** unless the wifi
     is solid — everything else is drawn from our own data and needs no internet.

3. **Fleet.** 60 vehicles, two operators, eight zones. Mode dot beside each type, battery bar,
   status chip. Filter by status → server-side refetch, footer count updates. Filter to
   `retired` → empty state that tells you what to do, with a Clear filters button.

4. **The rail.** Four dimmed icons, each with a tooltip naming the sprint it arrives in. Say
   this out loud — it shows the roadmap is planned, not forgotten.

5. **Sign out**, then reload. You stay signed out: the access token only ever lived in memory.

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
```

243 tests — 235 API, 8 frontend.

---

## When something breaks

| Symptom | Cause | Fix |
|---|---|---|
| Map is blank | No traffic data yet | `npm run demo:traffic` |
| Map is all green | Off-peak in the diurnal curve | The `demo` script pins 18:30; if you ran `traffic:sim` bare, add `-- --hour 18.5` |
| Map shows a red "Map error" banner | MapLibre failed | Read the banner — it names the cause |
| Roads grey, not coloured | Snapshots empty | `npm run demo:traffic`, wait one tick |
| "Could not reach the server" on sign-in | API not running | Check the `api` pane; `fuser -k 4000/tcp` then restart |
| Colours never change | Socket blocked | Harmless — the map also polls every 15s |
| `EADDRINUSE` | Stale process | `fuser -k 4000/tcp; fuser -k 5173/tcp` |
| `ER_NOT_SUPPORTED_AUTH_MODE` | Wrong MySQL driver | Must be `mysql2`; MySQL 8.4 removed `mysql_native_password` |
| Everything is broken | | `git checkout master` — Sprint 1 alone, fully tested, Fleet screen works |

---

## What to say about scope

Built: **M01** users and access, **M02** traffic monitoring, **M03** vehicle management,
**M11** basic KPIs, **M12** weather. Five of sixteen modules, across Sprints 1 and 2.

The count undersells it — those five include every piece of shared infrastructure the other
eleven stand on: the migration system, spatial handling, auth and RBAC, the cache/jobs/event-bus
adapters, the Socket.IO gateway, and the test harness.

Remaining, in order: routing and the demand model (Sprint 3, needs a Python FastAPI service),
the SimPy simulator (Sprint 4), fleet optimisation and analysis (Sprint 5), then notifications,
billing, GBFS and emergency response (Sprint 6).

Honest framing if asked why it isn't finished: the foundation is disproportionately expensive
and it is done. Sprint 3 onward adds features to a working system rather than building the
system.
