import { Router } from 'express';
import { QueryTypes } from 'sequelize';
import { z } from 'zod';
import type { KpiDto } from '@mm/shared-types';
import { sequelize } from '../../db/index.ts';
import { cache } from '../../cache/index.ts';
import { CACHE_KEYS } from '../../cache/keys.ts';
import { ok } from '../../lib/envelope.ts';
import { requireAuth } from '../../middleware/auth.ts';
import { asyncHandler } from '../../middleware/error.ts';
import { query, validate } from '../../middleware/validate.ts';
import { emissionFactors } from './rollups.ts';

export const analyticsRoutes = Router();

analyticsRoutes.use(requireAuth);

/**
 * M11, basic half.
 *
 * Reads counts and the snapshot table — never a GROUP BY over raw telemetry,
 * per CLAUDE.md. `readingsLastHour` is the one bounded scan, and it is bounded
 * by time so partition pruning applies.
 */
async function loadKpis(): Promise<KpiDto> {
  const [row] = await sequelize.query<{
    vehicles_total: string;
    vehicles_available: string;
    vehicles_in_use: string;
    segments_monitored: string;
    city_congestion: string | null;
    congested_segments: string;
    readings_last_hour: string;
    trips_today: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM vehicles WHERE deleted_at IS NULL)                        AS vehicles_total,
       (SELECT COUNT(*) FROM vehicles WHERE deleted_at IS NULL AND status='available') AS vehicles_available,
       (SELECT COUNT(*) FROM vehicles WHERE deleted_at IS NULL AND status='in_use')    AS vehicles_in_use,
       (SELECT COUNT(*) FROM traffic_snapshots)                                        AS segments_monitored,
       (SELECT AVG(congestion_index) FROM traffic_snapshots)                           AS city_congestion,
       (SELECT COUNT(*) FROM traffic_snapshots WHERE congestion_index >= 0.6)          AS congested_segments,
       (SELECT COUNT(*) FROM traffic_readings
         WHERE observed_at >= DATE_SUB(NOW(3), INTERVAL 1 HOUR))                       AS readings_last_hour,
       (SELECT COUNT(*) FROM trips WHERE started_at >= CURDATE())                      AS trips_today`,
    { type: QueryTypes.SELECT },
  );

  return {
    vehiclesTotal: Number(row?.vehicles_total ?? 0),
    vehiclesAvailable: Number(row?.vehicles_available ?? 0),
    vehiclesInUse: Number(row?.vehicles_in_use ?? 0),
    segmentsMonitored: Number(row?.segments_monitored ?? 0),
    cityCongestionIndex: Number(Number(row?.city_congestion ?? 0).toFixed(3)),
    congestedSegments: Number(row?.congested_segments ?? 0),
    readingsLastHour: Number(row?.readings_last_hour ?? 0),
    tripsToday: Number(row?.trips_today ?? 0),
  };
}

analyticsRoutes.get(
  '/kpis',
  asyncHandler(async (_req, res) => {
    const day = new Date().toISOString().slice(0, 10);
    const spec = CACHE_KEYS.kpis(day);
    res.json(ok(await cache.wrap(spec.key, spec.ttl, loadKpis)));
  }),
);


// ---- M11 full: rollup-backed dashboards ------------------------------------

/**
 * Everything below reads `kpi_daily` and `zone_daily_rollups` only.
 *
 * CLAUDE.md: aggregation endpoints are backed by nightly rollup tables, never a
 * GROUP BY over raw data at request time. `jobs/register.ts` owns the writer.
 * A dashboard that is empty because the rollup has not run is the correct
 * failure — it is visible, and one command fixes it.
 */

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Defaults to the last 30 days when the caller gives no range. */
function resolveRange(q: { from?: string; to?: string }): { from: string; to: string } {
  const to = q.to ?? new Date().toISOString().slice(0, 10);
  if (q.from) return { from: q.from, to };
  const d = new Date(`${to}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 29);
  return { from: d.toISOString().slice(0, 10), to };
}

interface KpiRow {
  day: string;
  trips: string;
  distance_km: string;
  duration_min: string;
  active_vehicles: string;
  trips_per_vehicle: string;
  mean_trip_km: string;
  mean_trip_min: string;
  energy_kwh: string;
  co2e_avoided_kg: string;
  modal_split: Record<string, number> | null;
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

async function dailyRows(from: string, to: string): Promise<KpiRow[]> {
  return sequelize.query<KpiRow>(
    `SELECT * FROM kpi_daily WHERE day BETWEEN :from AND :to ORDER BY day`,
    { replacements: { from, to }, type: QueryTypes.SELECT },
  );
}

/** Day-by-day series for the dashboard charts. */
analyticsRoutes.get(
  '/timeseries',
  validate({ query: rangeSchema }),
  asyncHandler(async (req, res) => {
    const { from, to } = resolveRange(query<z.infer<typeof rangeSchema>>(req));
    const rows = await dailyRows(from, to);

    res.json(
      ok(
        rows.map((r) => ({
          day: String(r.day).slice(0, 10),
          trips: n(r.trips),
          distanceKm: n(r.distance_km),
          activeVehicles: n(r.active_vehicles),
          tripsPerVehicle: n(r.trips_per_vehicle),
          meanTripKm: n(r.mean_trip_km),
          meanTripMin: n(r.mean_trip_min),
          energyKwh: n(r.energy_kwh),
          co2eAvoidedKg: n(r.co2e_avoided_kg),
        })),
        { from, to, days: rows.length },
      ),
    );
  }),
);

/** Totals over the range, plus per-zone breakdown. */
analyticsRoutes.get(
  '/summary',
  validate({ query: rangeSchema }),
  asyncHandler(async (req, res) => {
    const { from, to } = resolveRange(query<z.infer<typeof rangeSchema>>(req));
    const rows = await dailyRows(from, to);

    const totals = rows.reduce(
      (acc, r) => {
        acc.trips += n(r.trips);
        acc.distanceKm += n(r.distance_km);
        acc.durationMin += n(r.duration_min);
        acc.energyKwh += n(r.energy_kwh);
        acc.co2eAvoidedKg += n(r.co2e_avoided_kg);
        return acc;
      },
      { trips: 0, distanceKm: 0, durationMin: 0, energyKwh: 0, co2eAvoidedKg: 0 },
    );

    // Modal split is re-weighted by each day's trip count. Averaging the daily
    // percentages would let a quiet Sunday count as much as a busy Monday.
    const modal: Record<string, number> = {};
    for (const r of rows) {
      const split = r.modal_split ?? {};
      for (const [mode, share] of Object.entries(split)) {
        modal[mode] = (modal[mode] ?? 0) + share * n(r.trips);
      }
    }
    for (const k of Object.keys(modal)) {
      modal[k] = totals.trips > 0 ? Number((modal[k]! / totals.trips).toFixed(4)) : 0;
    }

    const zones = await sequelize.query<{
      zone_id: string;
      name: string;
      started: string;
      ended: string;
      net: string;
      km: string;
      co2: string;
    }>(
      `SELECT r.zone_id, z.name,
              SUM(r.trips_started) AS started, SUM(r.trips_ended) AS ended,
              SUM(r.net_flow) AS net, SUM(r.distance_km) AS km,
              SUM(r.co2e_avoided_kg) AS co2
         FROM zone_daily_rollups r
         JOIN zones z ON z.id = r.zone_id
        WHERE r.day BETWEEN :from AND :to
        GROUP BY r.zone_id, z.name
        ORDER BY started DESC`,
      { replacements: { from, to }, type: QueryTypes.SELECT },
    );

    res.json(
      ok(
        {
          range: { from, to, days: rows.length },
          totals: {
            trips: totals.trips,
            distanceKm: Number(totals.distanceKm.toFixed(2)),
            durationHours: Number((totals.durationMin / 60).toFixed(2)),
            energyKwh: Number(totals.energyKwh.toFixed(2)),
            co2eAvoidedKg: Number(totals.co2eAvoidedKg.toFixed(2)),
            tripsPerDay: rows.length > 0 ? Number((totals.trips / rows.length).toFixed(1)) : 0,
          },
          modalSplit: modal,
          zones: zones.map((z) => ({
            zoneId: String(z.zone_id),
            name: z.name,
            tripsStarted: n(z.started),
            tripsEnded: n(z.ended),
            netFlow: n(z.net),
            distanceKm: n(z.km),
            co2eAvoidedKg: n(z.co2),
          })),
        },
        { from, to },
      ),
    );
  }),
);

/** M10. The emissions claim, with the factors it rests on. */
analyticsRoutes.get(
  '/environment',
  validate({ query: rangeSchema }),
  asyncHandler(async (req, res) => {
    const { from, to } = resolveRange(query<z.infer<typeof rangeSchema>>(req));
    const rows = await dailyRows(from, to);
    const factors = await emissionFactors();

    const co2 = rows.reduce((a, r) => a + n(r.co2e_avoided_kg), 0);
    const energy = rows.reduce((a, r) => a + n(r.energy_kwh), 0);
    const km = rows.reduce((a, r) => a + n(r.distance_km), 0);

    res.json(
      ok({
        range: { from, to, days: rows.length },
        co2eAvoidedKg: Number(co2.toFixed(2)),
        energyKwh: Number(energy.toFixed(2)),
        distanceKm: Number(km.toFixed(2)),
        gPerKmSaved: km > 0 ? Number(((co2 * 1000) / km).toFixed(1)) : 0,
        // Stated, not implied: the whole number is a counterfactual about car
        // trips, and a reader who rejects the counterfactual should see it.
        counterfactual: 'Each trip is assumed to replace a car trip of equal distance.',
        factors: [...factors.values()],
      }),
    );
  }),
);

/**
 * CSV export.
 *
 * Streamed as text/csv with a filename rather than returned as JSON for the
 * browser to convert: the point of an export is that it opens in a spreadsheet.
 * CSV only — PDF is in MODULES.md but needs a renderer, and a spreadsheet is
 * what a report of daily numbers is actually read in.
 */
analyticsRoutes.get(
  '/export',
  validate({ query: rangeSchema }),
  asyncHandler(async (req, res) => {
    const { from, to } = resolveRange(query<z.infer<typeof rangeSchema>>(req));
    const rows = await dailyRows(from, to);

    const header = [
      'day', 'trips', 'distance_km', 'duration_min', 'active_vehicles',
      'trips_per_vehicle', 'mean_trip_km', 'mean_trip_min', 'energy_kwh', 'co2e_avoided_kg',
    ];

    /** RFC 4180: quote everything containing a comma, quote or newline. */
    const cell = (v: unknown): string => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    };

    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [
          String(r.day).slice(0, 10), r.trips, r.distance_km, r.duration_min,
          r.active_vehicles, r.trips_per_vehicle, r.mean_trip_km, r.mean_trip_min,
          r.energy_kwh, r.co2e_avoided_kg,
        ]
          .map(cell)
          .join(','),
      ),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="kpi-${from}-to-${to}.csv"`);
    res.send(lines.join('\n') + '\n');
  }),
);
