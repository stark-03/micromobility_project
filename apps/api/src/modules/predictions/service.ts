import { QueryTypes } from 'sequelize';
import { sequelize } from '../../db/index.ts';
import { env } from '../../config/env.ts';
import { AppError } from '../../lib/errors.ts';
import { logger } from '../../lib/logger.ts';

/**
 * M05 demand prediction.
 *
 * Express owns the data and the registry; the ML service owns the fitting.
 * Training is a JOB, never a request handler (CLAUDE.md) — the route queues it
 * and returns a job id.
 */

export interface HistoryRow {
  zone_id: string;
  slot_start: string;
  trips: number;
  population_ix: number;
  precipitation_mm: number;
  temp_c: number;
}

const SLOT_SECONDS = 900;

/**
 * Trips aggregated into 15-minute slots per zone, with weather joined on.
 *
 * SQL groups; JavaScript fills the grid. A recursive CTE generating the slot
 * series is the obvious approach and it dies at MySQL's default
 * cte_max_recursion_depth of 1000 — six weeks is 4032 slots. Raising the
 * session variable would work until someone asked for twelve weeks.
 */
export async function loadDemandHistory(weeks = 6): Promise<HistoryRow[]> {
  const [counts, zones, weather] = await Promise.all([
    sequelize.query<{ zone_id: string; slot_epoch: string; trips: string }>(
      `SELECT start_zone_id AS zone_id,
              FLOOR(UNIX_TIMESTAMP(started_at) / 900) * 900 AS slot_epoch,
              COUNT(*) AS trips
       FROM trips
       WHERE started_at >= DATE_SUB(NOW(), INTERVAL ? WEEK) AND start_zone_id IS NOT NULL
       GROUP BY start_zone_id, slot_epoch`,
      { type: QueryTypes.SELECT, replacements: [weeks] },
    ),
    sequelize.query<{ id: string; population_ix: string | null }>(
      'SELECT id, population_ix FROM zones ORDER BY id',
      { type: QueryTypes.SELECT },
    ),
    sequelize.query<{
      zone_id: string;
      slot_epoch: string;
      precipitation_mm: string | null;
      temp_c: string | null;
    }>(
      `SELECT zone_id,
              FLOOR(UNIX_TIMESTAMP(observed_at) / 900) * 900 AS slot_epoch,
              precipitation_mm, temp_c
       FROM weather_readings
       WHERE observed_at >= DATE_SUB(NOW(), INTERVAL ? WEEK)`,
      { type: QueryTypes.SELECT, replacements: [weeks] },
    ),
  ]);

  if (counts.length === 0 || zones.length === 0) return [];

  const tripsBy = new Map<string, number>();
  let minEpoch = Number.POSITIVE_INFINITY;
  let maxEpoch = 0;
  for (const c of counts) {
    const epoch = Number(c.slot_epoch);
    tripsBy.set(`${c.zone_id}:${epoch}`, Number(c.trips));
    if (epoch < minEpoch) minEpoch = epoch;
    if (epoch > maxEpoch) maxEpoch = epoch;
  }

  const weatherBy = new Map<string, { p: number; t: number }>();
  for (const w of weather) {
    weatherBy.set(`${w.zone_id}:${Number(w.slot_epoch)}`, {
      p: Number(w.precipitation_mm ?? 0),
      t: Number(w.temp_c ?? 25),
    });
  }

  const out: HistoryRow[] = [];
  for (const z of zones) {
    const pop = Number(z.population_ix ?? 6);
    for (let epoch = minEpoch; epoch <= maxEpoch; epoch += SLOT_SECONDS) {
      const key = `${z.id}:${epoch}`;
      const w = weatherBy.get(key);
      out.push({
        zone_id: String(z.id),
        slot_start: new Date(epoch * 1000).toISOString(),
        // Absent means zero, not missing. Without this the model only ever
        // sees busy slots and infers demand is uniformly high.
        trips: tripsBy.get(key) ?? 0,
        population_ix: pop,
        precipitation_mm: w?.p ?? 0,
        temp_c: w?.t ?? 25,
      });
    }
  }

  return out;
}

async function callMl<T>(path: string, payload: unknown, timeoutMs = 120_000): Promise<T> {
  if (!env.mlServiceUrl) {
    throw new AppError('SERVICE_UNAVAILABLE', 'The ML service is not configured');
  }
  let res: Response;
  try {
    res = await fetch(`${env.mlServiceUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': env.mlInternalSecret },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE', 'The ML service is not reachable');
  }
  if (res.status === 409) {
    throw new AppError('SERVICE_UNAVAILABLE', 'No demand model has been trained yet');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new AppError('SERVICE_UNAVAILABLE', body.detail ?? `ML service returned ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface TrainingResult {
  version: string;
  algorithm: string;
  trained_from: string;
  trained_to: string;
  valid_from: string;
  valid_to: string;
  train_rows: number;
  valid_rows: number;
  mae: number;
  rmse: number;
  mape: number;
  baseline_mae: number;
  skill_ratio: number;
  meets_target: boolean;
  features: string[];
}

/**
 * Trains and records the result.
 *
 * design.md §4: a model with no recorded eval does not get an is_active flag.
 * So `is_active` is set from the measured skill ratio, not from the fact that
 * training completed — a model that fails to beat the baseline is registered
 * and left inactive rather than quietly shipped.
 */
export async function trainDemandModel(weeks = 6, validDays = 7): Promise<TrainingResult> {
  const started = Date.now();
  const history = await loadDemandHistory(weeks);
  if (history.length === 0) {
    throw AppError.validationFailed([
      { path: 'history', message: 'No trip history. Run npm run demand:backfill first.' },
    ]);
  }

  const [run] = await sequelize.query(
    `INSERT INTO model_runs (kind, status, started_at) VALUES ('train', 'running', NOW(3))`,
  );
  const runId = Number(run);

  try {
    const result = await callMl<TrainingResult>('/internal/ml/train', {
      history,
      valid_days: validDays,
    });

    await sequelize.query(
      `INSERT INTO model_registry
         (name, version, kind, algorithm, trained_from, trained_to, valid_from, valid_to,
          train_rows, valid_rows, mae, rmse, mape, baseline_mae, skill_ratio, is_active, features)
       VALUES ('demand', ?, 'demand', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      {
        replacements: [
          result.version,
          result.algorithm,
          new Date(result.trained_from),
          new Date(result.trained_to),
          new Date(result.valid_from),
          new Date(result.valid_to),
          result.train_rows,
          result.valid_rows,
          result.mae,
          result.rmse,
          Number.isFinite(result.mape) ? result.mape : null,
          result.baseline_mae,
          result.skill_ratio,
          result.meets_target ? 1 : 0,
          JSON.stringify(result.features),
        ],
      },
    );

    // Exactly one active model per kind.
    if (result.meets_target) {
      await sequelize.query(
        `UPDATE model_registry SET is_active = 0 WHERE kind = 'demand' AND version <> ?`,
        { replacements: [result.version] },
      );
    }

    await sequelize.query(
      `UPDATE model_runs SET status='completed', finished_at=NOW(3), duration_ms=?, metrics=?
       WHERE id = ?`,
      { replacements: [Date.now() - started, JSON.stringify(result), runId] },
    );

    logger.info('demand model trained', {
      version: result.version,
      mae: result.mae,
      baselineMae: result.baseline_mae,
      skillRatio: result.skill_ratio,
      active: result.meets_target,
    });

    return result;
  } catch (e) {
    await sequelize.query(
      `UPDATE model_runs SET status='failed', finished_at=NOW(3), error=? WHERE id = ?`,
      { replacements: [e instanceof Error ? e.message : String(e), runId] },
    );
    throw e;
  }
}

export interface Forecast {
  zoneId: string;
  slotStart: string;
  horizonMin: number;
  predictedTrips: number;
  p10: number;
  p90: number;
  modelVersion: string;
}

export async function forecastDemand(horizonSlots = 4, weeks = 3): Promise<Forecast[]> {
  const history = await loadDemandHistory(weeks);
  const { forecasts } = await callMl<{ forecasts: Forecast[] }>(
    '/internal/ml/predict/demand',
    { history, horizon_slots: horizonSlots },
    30_000,
  );

  // Persist so a forecast can be scored against what actually happened later.
  for (const f of forecasts) {
    await sequelize.query(
      `INSERT INTO demand_forecasts
         (zone_id, slot_start, horizon_min, predicted_trips, p10, p90, model_version)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         predicted_trips = VALUES(predicted_trips), p10 = VALUES(p10), p90 = VALUES(p90),
         horizon_min = VALUES(horizon_min), generated_at = NOW(3)`,
      {
        replacements: [
          f.zoneId,
          new Date(f.slotStart),
          f.horizonMin,
          f.predictedTrips,
          f.p10,
          f.p90,
          f.modelVersion,
        ],
      },
    );
  }

  return forecasts;
}

export async function listModels(): Promise<unknown[]> {
  return sequelize.query(
    `SELECT id, name, version, kind, algorithm, train_rows, valid_rows,
            mae, rmse, mape, baseline_mae, skill_ratio, is_active, created_at
     FROM model_registry ORDER BY created_at DESC LIMIT 25`,
    { type: QueryTypes.SELECT },
  );
}
