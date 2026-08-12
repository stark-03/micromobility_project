"""The feature builder.

design.md §4 is explicit that features are "defined once in ml/app/features.py"
and shared by training and inference. That is not tidiness — it is the only way
to guarantee the columns a model was fitted on are the columns it is served,
in the same order, with the same encoding. Two builders drift, and the drift is
silent: the model keeps returning numbers, just wrong ones.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# Lags in 15-minute slots: 15 min, 30 min, 1 h, 6 h, 1 day, 1 week back.
# design.md §4 names (1, 2, 4, 24, 168) in slot units.
LAGS = (1, 2, 4, 24, 96, 672)

FEATURE_COLUMNS = [
    "zone_code",
    *[f"lag_{n}" for n in LAGS],
    "roll_mean_4",
    "roll_mean_24",
    "hour_sin",
    "hour_cos",
    "dow_sin",
    "dow_cos",
    "is_weekend",
    "is_holiday",
    "population_ix",
    "precipitation_mm",
    "temp_c",
]

TARGET = "trips"

# Fixed-date Indian public holidays plus Karnataka's Rajyotsava. A real system
# would read a calendar; the point here is that the flag exists and is used.
HOLIDAYS_MMDD = {"01-01", "01-26", "05-01", "08-15", "10-02", "11-01", "12-25"}


def _is_holiday(ts: pd.Series) -> pd.Series:
    return ts.dt.strftime("%m-%d").isin(HOLIDAYS_MMDD).astype(int)


def build_features(history: pd.DataFrame) -> pd.DataFrame:
    """Turn a per-zone slot series into a model-ready frame.

    `history` needs columns: zone_id, slot_start, trips, and optionally
    population_ix, precipitation_mm, temp_c.

    Lags are computed WITHIN each zone. Computing them across the whole frame
    would let one zone's history leak into another's features — the rows are
    interleaved by time, so a global shift() silently pulls the previous zone's
    value.
    """
    df = history.copy()
    df["slot_start"] = pd.to_datetime(df["slot_start"])
    df = df.sort_values(["zone_id", "slot_start"]).reset_index(drop=True)

    for col, default in (("population_ix", 6.0), ("precipitation_mm", 0.0), ("temp_c", 25.0)):
        if col not in df.columns:
            df[col] = default
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(default)

    grouped = df.groupby("zone_id", sort=False)["trips"]
    for n in LAGS:
        df[f"lag_{n}"] = grouped.shift(n)

    # Rolling means are shifted by one slot first, so the current value is never
    # part of its own feature.
    shifted = grouped.shift(1)
    df["roll_mean_4"] = shifted.rolling(4, min_periods=1).mean().reset_index(level=0, drop=True)
    df["roll_mean_24"] = shifted.rolling(24, min_periods=1).mean().reset_index(level=0, drop=True)

    # Cyclic encoding: 23:45 and 00:00 are adjacent, and a raw integer hour
    # tells the model they are 23 apart.
    hour_of_day = df["slot_start"].dt.hour + df["slot_start"].dt.minute / 60.0
    df["hour_sin"] = np.sin(2 * np.pi * hour_of_day / 24.0)
    df["hour_cos"] = np.cos(2 * np.pi * hour_of_day / 24.0)

    dow = df["slot_start"].dt.dayofweek
    df["dow_sin"] = np.sin(2 * np.pi * dow / 7.0)
    df["dow_cos"] = np.cos(2 * np.pi * dow / 7.0)

    df["is_weekend"] = dow.isin([5, 6]).astype(int)
    df["is_holiday"] = _is_holiday(df["slot_start"])

    # Zone identity as a categorical. population_ix alone is a weak proxy: two
    # zones can share a population index and still have completely different
    # demand shapes, and only the identity lets the model learn that.
    df["zone_code"] = df["zone_id"].astype("category").cat.codes.astype(int)

    return df


def usable_rows(features: pd.DataFrame) -> pd.DataFrame:
    """Drop rows whose lags could not be computed.

    The first week of every zone has no 672-slot lag. Keeping those rows with
    an imputed value would teach the model that "no history" is a real state,
    which it is not — it is an artefact of where the data happens to start.
    """
    return features.dropna(subset=[f"lag_{n}" for n in LAGS]).reset_index(drop=True)
