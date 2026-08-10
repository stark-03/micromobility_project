import { Router } from 'express';
import { QueryTypes } from 'sequelize';
import type { KpiDto } from '@mm/shared-types';
import { sequelize } from '../../db/index.ts';
import { cache } from '../../cache/index.ts';
import { CACHE_KEYS } from '../../cache/keys.ts';
import { ok } from '../../lib/envelope.ts';
import { requireAuth } from '../../middleware/auth.ts';
import { asyncHandler } from '../../middleware/error.ts';

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
