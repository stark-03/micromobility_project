# ML & routing service

FastAPI sidecar. Owns everything numeric — graph search now, forecasting and
simulation in later sprints.

**Express is the only permitted caller.** The browser never talks to port 8000.
Internal routes are prefixed `/internal/` and require the shared secret header.
The service holds **no database credentials** by design (`design.md` §2): every
request carries the subgraph it needs, which is what keeps it stateless.

## Setup

This machine uses **conda**, and Python **3.12** rather than 3.13 — conda-forge
builds for the ML stack lag a release, which is the missing-wheel problem
`CLAUDE.md` warns about.

```bash
conda create -n micromobility python=3.12 -y
conda activate micromobility
pip install -r apps/ml/requirements.txt
```

Verified interpreter: **Python 3.12.13**.

## Run

```bash
conda activate micromobility
cd apps/ml
uvicorn app.main:app --reload --port 8000
```

## Test

```bash
conda activate micromobility
cd apps/ml
pytest -q
ruff check .
```

## Endpoints

| Route | Purpose |
|---|---|
| `GET /healthz` | Liveness. Unauthenticated — Express probes it for `/readyz`. |
| `GET /internal/routing/profiles` | The three profiles and their weights. |
| `POST /internal/routing/plan` | One route for one profile. |
| `POST /internal/routing/compare` | All three profiles for one origin/destination pair. |

## Edge cost

Verbatim from `design.md` §4:

```
cost = w_d·(length/speed_free)
     + w_c·congestion_delay
     + w_s·(1 - safety_score/100)
     + w_g·gradient_penalty
```

| Profile | w_d | w_c | w_s | w_g |
|---|---|---|---|---|
| fastest | 1.0 | 1.0 | 0.1 | 0.2 |
| safest | 1.0 | 0.6 | 1.2 | 0.3 |
| greenest | 0.8 | 0.5 | 0.5 | 0.9 |

Weights are data, not code — a fourth profile is a dict entry.

## Notes worth knowing

- **A\* must stay optimal.** The heuristic is straight-line time at the fastest
  speed on the network, which can never overestimate. A test asserts A\* returns
  the same path as Dijkstra; an inadmissible heuristic would silently return
  slightly-wrong routes.
- **The graph is directed**, because one-way streets are real and a router that
  ignores them sends riders the wrong way up an arterial.
- **A jammed road is expensive but finite.** An infinite cost would make the
  router refuse to plan rather than route around.
- **`safety_score` is provisional.** M09 owns the real thing; until then Express
  derives it from lighting, bike lanes, road class, speed and lane count. A
  constant score made `safest` mathematically identical to `fastest`.
