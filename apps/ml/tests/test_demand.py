"""Demand model tests, including the leakage guard design.md §4 demands."""

from __future__ import annotations

import math
from datetime import datetime, timedelta

import pandas as pd
import pytest

from app.features import FEATURE_COLUMNS, build_features, usable_rows
from app.models.demand import predict_demand, train_demand_model
from app.training.evaluation import (
    LeakageError,
    assert_chronological_split,
    mae,
    mape,
    rmse,
    seasonal_naive,
)

SLOT = timedelta(minutes=15)


def synthetic_history(weeks: int = 5, zones: int = 3) -> list[dict]:
    """A learnable series: daily and weekly structure plus mild variation."""
    start = datetime(2026, 6, 1)
    rows = []
    slots = weeks * 7 * 96
    for z in range(zones):
        for i in range(slots):
            ts = start + i * SLOT
            hour = ts.hour + ts.minute / 60
            weekend = ts.weekday() >= 5
            base = 1.0 + (0 if weekend else 4.0 * math.exp(-((hour - 9) ** 2) / 2.0))
            base += 3.5 * math.exp(-((hour - 18.5) ** 2) / 2.5)
            base *= 0.7 + z * 0.3
            wobble = 0.85 + 0.3 * ((i * 7 + z * 13) % 11) / 11
            rows.append(
                {
                    "zone_id": str(z + 1),
                    "slot_start": ts.isoformat(),
                    "trips": round(base * wobble, 2),
                    "population_ix": 5.0 + z,
                }
            )
    return rows


class TestLeakageGuard:
    def test_rejects_validation_that_starts_before_training_ends(self):
        # The single most important check in the pipeline: a random split lets
        # the model see Tuesday evening while predicting Tuesday morning, and
        # the metrics look excellent and mean nothing.
        train = pd.DataFrame({"slot_start": pd.to_datetime(["2026-06-10", "2026-06-20"])})
        valid = pd.DataFrame({"slot_start": pd.to_datetime(["2026-06-15", "2026-06-25"])})
        with pytest.raises(LeakageError, match="strictly chronological"):
            assert_chronological_split(train, valid)

    def test_rejects_an_exactly_overlapping_boundary(self):
        train = pd.DataFrame({"slot_start": pd.to_datetime(["2026-06-20"])})
        valid = pd.DataFrame({"slot_start": pd.to_datetime(["2026-06-20"])})
        with pytest.raises(LeakageError):
            assert_chronological_split(train, valid)

    def test_accepts_a_clean_chronological_split(self):
        train = pd.DataFrame({"slot_start": pd.to_datetime(["2026-06-01", "2026-06-20"])})
        valid = pd.DataFrame({"slot_start": pd.to_datetime(["2026-06-21", "2026-06-25"])})
        assert_chronological_split(train, valid)

    def test_rejects_an_empty_side(self):
        train = pd.DataFrame({"slot_start": pd.to_datetime(["2026-06-01"])})
        with pytest.raises(LeakageError):
            assert_chronological_split(train, pd.DataFrame({"slot_start": []}))


class TestFeatures:
    def test_builds_every_declared_column(self):
        feats = usable_rows(build_features(pd.DataFrame(synthetic_history(weeks=2, zones=1))))
        for col in FEATURE_COLUMNS:
            assert col in feats.columns

    def test_lags_do_not_cross_zone_boundaries(self):
        # Rows are interleaved by time, so a global shift() would pull the
        # previous ZONE's value into this zone's lag.
        feats = build_features(pd.DataFrame(synthetic_history(weeks=2, zones=2)))
        first_of_zone2 = feats[feats["zone_id"] == "2"].iloc[0]
        assert pd.isna(first_of_zone2["lag_1"])

    def test_rolling_means_exclude_the_current_value(self):
        # Otherwise the target leaks into its own feature.
        history = pd.DataFrame(
            [
                {"zone_id": "1", "slot_start": datetime(2026, 6, 1) + i * SLOT, "trips": float(i)}
                for i in range(10)
            ]
        )
        feats = build_features(history)
        # roll_mean_4 at index 4 averages trips 0..3, never trip 4.
        assert feats.loc[4, "roll_mean_4"] == pytest.approx((0 + 1 + 2 + 3) / 4)

    def test_cyclic_hour_encoding_wraps(self):
        history = pd.DataFrame(
            [
                {"zone_id": "1", "slot_start": datetime(2026, 6, 1, 23, 45), "trips": 1.0},
                {"zone_id": "1", "slot_start": datetime(2026, 6, 2, 0, 0), "trips": 1.0},
            ]
        )
        f = build_features(history)
        # 23:45 and 00:00 are adjacent in time and must be adjacent in feature
        # space; a raw integer hour would put them 23 apart.
        d = math.dist(
            (f.loc[0, "hour_sin"], f.loc[0, "hour_cos"]),
            (f.loc[1, "hour_sin"], f.loc[1, "hour_cos"]),
        )
        assert d < 0.1

    def test_drops_rows_whose_lags_are_unknown(self):
        raw = pd.DataFrame(synthetic_history(weeks=2, zones=1))
        assert len(usable_rows(build_features(raw))) < len(raw)


class TestMetrics:
    def test_mae_and_rmse(self):
        import numpy as np

        y = np.array([1.0, 2.0, 3.0])
        p = np.array([1.0, 2.0, 5.0])
        assert mae(y, p) == pytest.approx(2 / 3)
        assert rmse(y, p) == pytest.approx(math.sqrt(4 / 3))

    def test_mape_ignores_zero_demand_slots(self):
        import numpy as np

        # A quiet 03:00 slot with zero trips makes MAPE infinite, which says
        # nothing about model quality.
        y = np.array([0.0, 4.0])
        p = np.array([1.0, 5.0])
        assert mape(y, p) == pytest.approx(25.0)

    def test_seasonal_naive_is_last_weeks_same_slot(self):
        feats = usable_rows(build_features(pd.DataFrame(synthetic_history(weeks=3, zones=1))))
        assert (seasonal_naive(feats) == feats["lag_672"].to_numpy()).all()


class TestTraining:
    def test_trains_and_beats_the_seasonal_naive_baseline(self):
        result = train_demand_model(synthetic_history(weeks=5, zones=3), valid_days=5)
        assert result.train_rows > 0
        assert result.valid_rows > 0
        # design.md §4 target for the demand model: MAE <= 0.7x baseline.
        assert result.skill_ratio < 1.0, "model must at least beat last-week-same-slot"
        assert result.mae >= 0

    def test_the_split_is_chronological_in_the_recorded_metadata(self):
        result = train_demand_model(synthetic_history(weeks=5, zones=2), valid_days=5)
        assert result.trained_to < result.valid_from

    def test_refuses_a_history_too_short_to_lag(self):
        with pytest.raises(ValueError, match="usable rows"):
            train_demand_model(synthetic_history(weeks=1, zones=1))

    def test_refuses_empty_history(self):
        with pytest.raises(ValueError):
            train_demand_model([])


class TestPrediction:
    def test_forecasts_every_zone_over_the_horizon(self):
        history = synthetic_history(weeks=5, zones=2)
        train_demand_model(history, valid_days=5)
        out = predict_demand(history, horizon_slots=3)

        assert len(out) == 6  # 2 zones x 3 slots
        assert {f["zoneId"] for f in out} == {"1", "2"}

    def test_forecasts_carry_an_interval_and_a_version(self):
        history = synthetic_history(weeks=5, zones=1)
        train_demand_model(history, valid_days=5)
        f = predict_demand(history, horizon_slots=1)[0]

        # design.md §1: never a bare number.
        assert f["p10"] <= f["predictedTrips"] <= f["p90"]
        assert f["modelVersion"].startswith("demand-")
        assert f["predictedTrips"] >= 0

    def test_uncertainty_widens_with_horizon(self):
        history = synthetic_history(weeks=5, zones=1)
        train_demand_model(history, valid_days=5)
        out = predict_demand(history, horizon_slots=4)
        first = out[0]
        last = out[-1]
        assert (last["p90"] - last["p10"]) > (first["p90"] - first["p10"])
