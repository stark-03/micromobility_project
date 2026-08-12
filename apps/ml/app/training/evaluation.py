"""Metrics and the leakage guard."""

from __future__ import annotations

import numpy as np
import pandas as pd


class LeakageError(Exception):
    """Raised when a split would let the future inform the past."""


def assert_chronological_split(train: pd.DataFrame, valid: pd.DataFrame) -> None:
    """Refuse a split where the validation window precedes any training row.

    design.md §4: "splits are chronological, never random. The evaluation
    harness refuses a split where the validation window precedes any training
    timestamp."

    This is the single most important check in the pipeline. A random split on
    a time series lets the model see a Tuesday evening while predicting that
    same Tuesday morning, and the resulting metrics look excellent and mean
    nothing.
    """
    if train.empty or valid.empty:
        raise LeakageError("Both train and validation sets must be non-empty")

    train_max = pd.to_datetime(train["slot_start"]).max()
    valid_min = pd.to_datetime(valid["slot_start"]).min()

    if valid_min <= train_max:
        raise LeakageError(
            f"Validation starts {valid_min} but training runs to {train_max}. "
            "The split must be strictly chronological."
        )


def mae(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.mean(np.abs(y_true - y_pred)))


def rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.sqrt(np.mean((y_true - y_pred) ** 2)))


def mape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Mean absolute percentage error, ignoring zero-demand slots.

    A quiet 03:00 slot with zero trips makes MAPE infinite, which says nothing
    about model quality — so those rows are excluded rather than clamped.
    """
    mask = y_true > 0
    if not mask.any():
        return float("nan")
    return float(np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100.0)


def seasonal_naive(features: pd.DataFrame) -> np.ndarray:
    """The baseline from design.md §4: same slot, last week.

    A forecaster that cannot beat "what happened this time last week" has not
    earned its complexity, so every model is scored against this.
    """
    return features["lag_672"].to_numpy(dtype=float)
