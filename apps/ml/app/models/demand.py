"""LightGBM demand forecaster.

CLAUDE.md prefers LightGBM over a neural net for the shipped model: smaller,
faster to train on CPU, and better on tabular forecasting at this scale. A deep
model is optional and only for the report's comparison section.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta

import lightgbm as lgb
import numpy as np
import pandas as pd

from ..features import FEATURE_COLUMNS, LAGS, TARGET, build_features, usable_rows
from ..training.evaluation import assert_chronological_split, mae, mape, rmse, seasonal_naive

SLOT_MINUTES = 15

PARAMS = {
    "objective": "poisson",  # counts are non-negative and skewed
    "metric": "l1",
    "learning_rate": 0.04,
    "num_leaves": 63,
    "min_data_in_leaf": 25,
    "feature_fraction": 0.85,
    "bagging_fraction": 0.85,
    "bagging_freq": 1,
    "verbosity": -1,
    "seed": 42,  # a reported metric must be reproducible
}


@dataclass
class TrainingResult:
    version: str
    algorithm: str
    trained_from: str
    trained_to: str
    valid_from: str
    valid_to: str
    train_rows: int
    valid_rows: int
    mae: float
    rmse: float
    mape: float
    baseline_mae: float
    skill_ratio: float
    meets_target: bool
    features: list[str]
    best_iteration: int


_MODEL: lgb.Booster | None = None
_MODEL_VERSION: str | None = None


def train_demand_model(history: list[dict], valid_days: int = 7) -> TrainingResult:
    """Fit on everything up to a cutoff, validate on the days after it.

    The split is by TIME, never at random, and the guard runs before a single
    tree is grown.
    """
    raw = pd.DataFrame(history)
    if raw.empty:
        raise ValueError("No history supplied")

    feats = usable_rows(build_features(raw))
    if len(feats) < 500:
        raise ValueError(
            f"Only {len(feats)} usable rows after lag construction — "
            f"need at least {max(LAGS)} slots of history per zone"
        )

    cutoff = feats["slot_start"].max() - timedelta(days=valid_days)
    train = feats[feats["slot_start"] <= cutoff]
    valid = feats[feats["slot_start"] > cutoff]

    # Refuses the split if the future could inform the past.
    assert_chronological_split(train, valid)

    x_train = train[FEATURE_COLUMNS]
    y_train = train[TARGET].to_numpy(dtype=float)
    x_valid = valid[FEATURE_COLUMNS]
    y_valid = valid[TARGET].to_numpy(dtype=float)

    train_set = lgb.Dataset(x_train, label=y_train, categorical_feature=["zone_code"])
    booster = lgb.train(
        PARAMS,
        train_set,
        num_boost_round=1200,
        valid_sets=[lgb.Dataset(x_valid, label=y_valid, reference=train_set)],
        callbacks=[lgb.early_stopping(60, verbose=False), lgb.log_evaluation(0)],
    )

    pred = np.clip(booster.predict(x_valid, num_iteration=booster.best_iteration), 0, None)
    base = np.clip(seasonal_naive(valid), 0, None)

    model_mae = mae(y_valid, pred)
    baseline_mae = mae(y_valid, base)
    skill = model_mae / baseline_mae if baseline_mae > 0 else float("nan")

    version = f"demand-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

    global _MODEL, _MODEL_VERSION
    _MODEL = booster
    _MODEL_VERSION = version

    return TrainingResult(
        version=version,
        algorithm="lightgbm",
        trained_from=str(train["slot_start"].min()),
        trained_to=str(train["slot_start"].max()),
        valid_from=str(valid["slot_start"].min()),
        valid_to=str(valid["slot_start"].max()),
        train_rows=int(len(train)),
        valid_rows=int(len(valid)),
        mae=round(model_mae, 4),
        rmse=round(rmse(y_valid, pred), 4),
        mape=round(mape(y_valid, pred), 4),
        baseline_mae=round(baseline_mae, 4),
        skill_ratio=round(skill, 4),
        # design.md §4 target for the demand model.
        meets_target=bool(skill <= 0.7),
        features=list(FEATURE_COLUMNS),
        best_iteration=int(booster.best_iteration or 0),
    )


def has_model() -> bool:
    return _MODEL is not None


def model_version() -> str | None:
    return _MODEL_VERSION


def predict_demand(history: list[dict], horizon_slots: int = 4) -> list[dict]:
    """Forecast the next `horizon_slots` for every zone in the history.

    Recursive: each predicted slot is appended to the series before the next is
    built, because the model's strongest features are its own recent lags. The
    interval widens with horizon — a forecast four steps out is genuinely less
    certain, and design.md §1 insists forecasts ship with intervals rather than
    as a bare number.
    """
    if _MODEL is None:
        raise RuntimeError("No trained model in memory. Train first.")

    series = pd.DataFrame(history)
    series["slot_start"] = pd.to_datetime(series["slot_start"])
    out: list[dict] = []

    for step in range(1, horizon_slots + 1):
        feats = build_features(series)
        latest = feats.sort_values("slot_start").groupby("zone_id", as_index=False).tail(1)

        usable = latest.dropna(subset=[f"lag_{n}" for n in LAGS])
        if usable.empty:
            break

        pred = np.clip(_MODEL.predict(usable[FEATURE_COLUMNS]), 0, None)

        rows = []
        for (_, row), value in zip(usable.iterrows(), pred, strict=False):
            slot = row["slot_start"] + timedelta(minutes=SLOT_MINUTES)
            # Poisson-ish spread, widened by how far ahead we are guessing.
            spread = float(np.sqrt(max(value, 1.0))) * (1.0 + 0.18 * (step - 1))
            out.append(
                {
                    "zoneId": str(row["zone_id"]),
                    "slotStart": slot.isoformat(),
                    "horizonMin": step * SLOT_MINUTES,
                    "predictedTrips": round(float(value), 3),
                    "p10": round(max(0.0, float(value) - 1.28 * spread), 3),
                    "p90": round(float(value) + 1.28 * spread, 3),
                    "modelVersion": _MODEL_VERSION or "unknown",
                }
            )
            rows.append(
                {
                    "zone_id": row["zone_id"],
                    "slot_start": slot,
                    "trips": float(value),
                    "population_ix": row.get("population_ix", 6.0),
                    "precipitation_mm": row.get("precipitation_mm", 0.0),
                    "temp_c": row.get("temp_c", 25.0),
                }
            )

        series = pd.concat([series, pd.DataFrame(rows)], ignore_index=True)

    return out


def training_result_dict(result: TrainingResult) -> dict:
    return asdict(result)
