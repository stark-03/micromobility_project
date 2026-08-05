# Claude Code — Kickoff Prompts

## Before you paste anything

```bash
mkdir -p ai-micromobility-simulator/docs && cd ai-micromobility-simulator
git init
# CLAUDE.md goes at the repo root — Claude Code reads it automatically every session
cp /path/to/CLAUDE.md .
cp /path/to/design.md /path/to/MODULES.md docs/
git add -A && git commit -m "docs: project brief, design and module specs"
claude
```

`CLAUDE.md` must be at the root. `design.md` and `MODULES.md` live in `docs/` and get read on
demand — the kickoff prompt below tells Claude to read them first.

Start in **plan mode** (`Shift+Tab` twice) so you see the plan before any file is written.

---

## Prompt 1 — Sprint 1: foundation, auth, vehicle registry

> Read `CLAUDE.md`, `docs/design.md` and `docs/MODULES.md` in full before writing any code. They
> are the spec; follow them rather than your defaults, especially the stack, the MySQL 8.4 auth
> notes, and the Tailwind-owns-layout / MUI-owns-components rule.
>
> This is a college final-year project running natively on my laptop: MySQL 8.4.10, Node
> v22.23.1, npm 10.9.8, Python 3.13.11. **No Docker, no Redis.** MySQL is already installed and
> running on localhost:3306.
>
> Build **Sprint 1 only** (see the build order at the end of `MODULES.md`). Do not start Sprint 2
> work, do not stub out modules M04–M16, and do not create placeholder folders for things we
> aren't building yet.
>
> Sprint 1 scope:
>
> 1. **Monorepo scaffold** — npm workspaces: `apps/web` (React 18 + Vite + TS), `apps/api`
>    (Express 4 + TS), `packages/shared-types`. Root scripts `dev`, `dev:web`, `dev:api`,
>    `typecheck`, `lint`, `test`. Use `node --env-file` and `node --watch`; do not install
>    `dotenv` or `nodemon`. `.env.example` committed, `.env` gitignored.
> 2. **Database layer** — Sequelize 6 on the `mysql2` driver, umzug migrations, `db:create`,
>    `db:migrate`, `db:migrate:undo`, `db:make`, `db:seed` scripts. Migrations for: `users`,
>    `roles`, `user_roles`, `refresh_tokens`, `user_preferences`, `api_keys`, `audit_logs`,
>    `operators`, `zones`, `road_segments`, `vehicles`, `vehicle_status_history`. Follow the DDL
>    conventions in `design.md` §3 exactly — `snake_case`, `DATETIME(3)`, SRID 4326 spatial
>    columns with spatial indexes, FK constraints.
> 3. **Seed data** — a synthetic Belagavi demo city: ~8 zones with real-ish polygons, ~120 road
>    segments forming a connected graph, 2 operators, 60 vehicles across the four types, and one
>    account per role (`admin`, `planner`, `operator`, `commuter`, `analyst`) with a printed
>    password. Seeds must be idempotent — re-running must not duplicate rows.
> 4. **M01 User & Access Management** — the endpoints listed in `MODULES.md` M01. JWT access
>    token + rotating httpOnly refresh cookie with reuse detection, bcrypt, zod validation at
>    every route boundary, `requireRole` middleware, the `{ data, meta }` / `{ error }` envelopes,
>    and the error-code contract.
> 5. **M03 Vehicle Management** — CRUD plus the status state machine from `MODULES.md`. The state
>    machine is a pure function with its own unit tests; illegal transitions return
>    `INVALID_STATE_TRANSITION`.
> 6. **Adapter shells** — `api/src/cache/index.ts` (memory driver via `node-cache`, `wrap()`
>    helper, keys declared in `cache/keys.ts`), `api/src/jobs/runner.ts` (inline driver on
>    `worker_threads`, `enqueue(name, payload) → jobId`), `api/src/realtime/bus.ts`
>    (`EventEmitter`). Real implementations behind interfaces so Redis is a later driver swap.
>    Do not add `redis`, `ioredis` or `bullmq` to `package.json`.
> 7. **Frontend foundation** — `styles/tokens.css` with the exact token values from `design.md`
>    §6.2, `tailwind.config.js` and `app/theme.ts` both reading those variables, Tailwind with
>    `preflight: false`, `StyledEngineProvider injectFirst`. The app shell from the §6.4
>    wireframe: 56px top bar, 64px icon rail, content area. Archivo / Inter / IBM Plex Mono
>    loaded. Router with an auth guard.
> 8. **Two working screens** — Sign in, and Fleet (MUI `DataGrid` over `GET /vehicles`, with the
>    mode-colour dot per vehicle type, battery column, status chip). Both handle all four states:
>    loading, empty, error, ready.
> 9. **Tests** — Vitest unit tests for the state machine and token rotation; Supertest
>    integration tests for auth and vehicles against `micromobility_test`, each in a transaction
>    that rolls back. `npm run test` green.
> 10. **`README.md`** — exact setup steps for my machine, including the `CREATE USER … IDENTIFIED
>     WITH caching_sha2_password` SQL and the `allowPublicKeyRetrieval` note.
>
> Work in this order and **stop after each stage for me to review**: (a) plan + folder structure
> + package.json files, (b) migrations + models + seeds, (c) API modules + tests, (d) frontend.
> Don't move to the next stage until I say go.
>
> Before you start, list any assumptions you're making and any questions where the spec is
> ambiguous. If something in the spec seems wrong, say so rather than silently working around it.

---

## Follow-up prompts

Paste these one at a time, in separate sessions, once the previous sprint is committed and
working.

**Sprint 2 — ingest and live map**
> Sprint 1 is committed and working. Build Sprint 2 from `docs/MODULES.md`: M02 Traffic
> Monitoring, M12 Weather Monitoring, and the basic KPI half of M11. Include the device API-key
> auth path, the partitioned `traffic_readings` table with the monthly maintenance job, the
> 1-minute snapshot cron, the Socket.IO gateway with room authorization, and the Live map screen
> with the permanent legend card described in `design.md` §6.4. Write a synthetic traffic
> generator script so I can demo without real sensors. Same stop-and-review rhythm as before.

**Sprint 3 — routing and the first model**
> Build Sprint 3: M04 Route Planning and M05 AI Prediction. Scaffold `apps/ml` as a FastAPI
> service in its own Python 3.13 venv with pinned requirements. Implement the edge cost function
> and three profiles from `design.md` §4, A* over the seeded graph, and a LightGBM demand model
> with the shared feature builder. Chronological splits only — include the leakage-guard test
> that fails if a validation timestamp precedes any training timestamp. Express is the only
> caller of the ML service.

**Sprint 4 — the simulator**
> Build Sprint 4: M06 Simulation Engine. SimPy loop per `design.md` §5, scenario builder wizard,
> run monitor with WebSocket progress, results and baseline-comparison screens. One seeded RNG
> passed down — include the determinism test and the conservation tests.

**Sprint 5 — optimization and analysis**
> Build Sprint 5: M07 Fleet Optimization, M08 Parking & Docking, M09 Safety & Risk Analysis,
> M10 Environmental Analysis, and the full M11 analytics with nightly rollups.

**Sprint 6 — the rest and hardening**
> Build Sprint 6: M13 Notifications, M14 Payment & Billing with the mock gateway, M15 Smart City
> Integration adapters including the outbound GBFS feed, M16 Emergency Response. Then a hardening
> pass: rate limits, helmet, the privacy suppression rules from `design.md` §7, Playwright E2E
> for the sign-in → scenario → run → results → export flow, and the performance targets in §8.

---

## Prompts worth keeping around

**When something drifts from the spec**
> That doesn't match `docs/design.md` §6.2 — you hardcoded hex values in the component. Move them
> to tokens and read them through the Tailwind config. Re-read the section before fixing.

**Before a demo**
> Run the full quality gate: `npm run typecheck && npm run lint && npm run test`, then
> `cd apps/ml && pytest && ruff check .`. Fix what's broken. Then walk me through starting every
> process from a cold laptop and tell me exactly what to click for a five-minute demo.

**For the report**
> Generate the ER diagram and the sequence diagram for a simulation run as Mermaid in
> `docs/diagrams/`, matching what the code actually does now, not what the spec said it would do.
> Flag any place the two have diverged.

---

## Tips

- **Plan mode first, always.** `Shift+Tab` twice. Read the plan, then approve. Cheaper than
  reviewing 40 files afterwards.
- **Commit at every stop point**, with a message naming the module: `feat(M03): vehicle registry
  and status machine`. If a stage goes wrong you lose one stage, not a day.
- **One module per session.** Long sessions drift; the model starts forgetting the conventions in
  `CLAUDE.md`. Start fresh and say "read CLAUDE.md first".
- **Keep `CLAUDE.md` current.** When you settle a convention mid-build, add it there — it's the
  memory that survives between sessions.
- **Don't accept "I've implemented X" without running it.** Ask for the command and the output.
