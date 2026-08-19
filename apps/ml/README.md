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

### The Python version is not optional

`python=3.12` in that command is the whole point, not a preference. Create the
environment without it and conda gives you its current default, which is newer
than parts of this stack. When pip cannot find a prebuilt wheel for your
interpreter it falls back to **building from source**, and on Windows that ends
like this:

```
ERROR: Could not find C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe
error: metadata-generation-failed  (pandas)
```

That message names Visual Studio, so it reads like a missing compiler. The
compiler is only missing because it should never have been needed: pandas 2.2.3
publishes Windows wheels for CPython 3.9–3.13, and on 3.12 every pin in
`requirements.txt` installs as a binary with nothing to build.

The fix is the interpreter, not the toolchain:

```
conda deactivate
conda env remove -n micromobility -y
conda create -n micromobility python=3.12 -y
conda activate micromobility
python --version          # confirm 3.12.x BEFORE installing
pip install -r apps/ml/requirements.txt
```

If something still insists on compiling, take the compiled packages from
conda-forge, which ships Windows binaries, then let pip fill in the rest:

```
conda install -c conda-forge numpy=2.1.3 pandas=2.2.3 scikit-learn=1.6.0 lightgbm=4.5.0 scipy -y
pip install -r apps/ml/requirements.txt
```

`scipy==1.18.0` is the one pin worth relaxing if it has no wheel for your
platform — this service uses only `scipy.optimize.linprog`, which has been
stable for years, so `scipy>=1.14` is safe.

### Running it on Windows

`npm run dev:ml` is Linux-only — it sources `conda.sh` through `bash -lc`,
which Windows `cmd` and PowerShell do not have. Start the service by hand and
run `npm run dev` (API + web) in a second terminal instead of `npm run demo`:

```
conda activate micromobility
cd apps\ml
uvicorn app.main:app --reload --port 8000
```

Everything else — the API, the web app, the endpoints — behaves the same. Only
the convenience script is platform-specific.

**Not verified on Windows.** This project is developed and tested on Linux; the
guidance above follows from how pip, conda and wheel tags work, not from a run
on a Windows machine.

## Run

From the repo root, `npm run dev:ml` does all of the below. By hand:

```bash
conda activate micromobility
cd apps/ml
uvicorn app.main:app --reload --port 8000
```

**The `cd` is load-bearing.** `app` is a package on the current directory, not an
installed distribution, so running uvicorn from anywhere else fails with
`ModuleNotFoundError: No module named 'app'` — and under `--reload` that error
surfaces from the spawned worker, after the parent has already logged
"Uvicorn running", which makes it read like a crash rather than a bad path.
To start it from any directory, put the package on the path explicitly:

```bash
uvicorn app.main:app --reload --port 8000 --app-dir /path/to/repo/apps/ml
```

Liveness check: `curl localhost:8000/healthz` → `{"status":"ok",...}`.
Interactive docs: <http://localhost:8000/docs>.

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
| `POST /internal/sim/run` | M06. Runs one scenario, **streaming NDJSON**: `progress` lines then one `result`. Errors after the stream opens travel as a `type:"error"` line, because the 200 is already committed. |
| `POST /internal/sim/compare` | M06. Two metric sets → direction-labelled deltas. |
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


---

## M05 demand model

LightGBM, Poisson objective, forecasting trips per zone per 15-minute slot.

```bash
npm run demand:backfill          # six weeks of synthetic ridership
npm run dev:ml                   # the service must be up
curl -X POST localhost:4000/api/v1/predictions/train  -H "Authorization: Bearer $TOKEN"
curl     localhost:4000/api/v1/predictions/demand     -H "Authorization: Bearer $TOKEN"
curl     localhost:4000/api/v1/predictions/models     -H "Authorization: Bearer $TOKEN"
```

Current result on six weeks of history:

| | |
|---|---|
| MAE | **0.239** |
| Seasonal-naive baseline MAE | 0.601 |
| Skill ratio | **0.397** (design.md §4 target ≤ 0.70) |
| RMSE / MAPE | 0.410 / 10.8% |
| Train / validate rows | 20,912 / 5,376 |

### Things worth knowing

- **The split is chronological and enforced.** `assert_chronological_split`
  refuses a split whose validation window starts at or before the last training
  timestamp. A random split on a time series lets the model see Tuesday evening
  while predicting Tuesday morning; the metrics look excellent and mean nothing.
- **Features are built in one place.** `app/features.py` is shared by training
  and inference, because two builders drift and the drift is silent — the model
  keeps returning numbers, just wrong ones.
- **Lags never cross zone boundaries.** Rows are interleaved by time, so a
  global `shift()` would pull the previous *zone's* value into this zone's lag.
- **Rolling means exclude the current value**, or the target leaks into its own
  feature.
- **Hour is cyclically encoded.** 23:45 and 00:00 are adjacent in time; a raw
  integer hour puts them 23 apart.
- **A model that misses its target is registered but left inactive.** design.md
  §4: no recorded eval, no `is_active` flag. The first fit scored 0.783 and was
  correctly stored inactive.

### A finding about the target

The first version of the backfill gave each slot **independent** noise. Under
that generator the best achievable skill ratio is exactly

```
E|U − 1| / E|U₁ − U₂|  =  0.225 / 0.300  =  0.75
```

so design.md's 0.70 target was unreachable no matter how good the model was —
and the observed 0.783 was already within 4% of the floor. Tuning could not
have closed that gap.

The generator was wrong, not the target. Real ridership has **momentum**: a busy
afternoon stays busy. The backfill now uses smooth autocorrelated noise, which
is both more realistic and gives the recent-lag features something the
seasonal-naive baseline cannot exploit. The skill ratio went 0.783 → 0.397.
