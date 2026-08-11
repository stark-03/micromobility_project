import { Router } from 'express';
import { QueryTypes } from 'sequelize';
import { z } from 'zod';
import { sequelize } from '../../db/index.ts';
import { ok } from '../../lib/envelope.ts';
import { requireApiKey, requireAuth } from '../../middleware/auth.ts';
import { asyncHandler } from '../../middleware/error.ts';
import { deviceLimiter } from '../../middleware/rate-limit.ts';
import { body, query, validate } from '../../middleware/validate.ts';
import { getLiveTraffic, rebuildSnapshots } from './service.ts';

export const trafficRoutes = Router();
export const trafficIngestRoutes = Router();

const liveQuerySchema = z.object({ zoneId: z.string().regex(/^\d+$/).optional() });

trafficRoutes.get(
  '/live',
  requireAuth,
  validate({ query: liveQuerySchema }),
  asyncHandler(async (req, res) => {
    const { zoneId } = query<{ zoneId?: string }>(req);
    res.json(ok(await getLiveTraffic(zoneId)));
  }),
);

const historyQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  bucket: z.enum(['1m', '5m', '15m', '1h']).default('5m'),
});

const BUCKET_SECONDS: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600 };

/** Bounded by segment + time window, so MySQL can prune partitions. */
trafficRoutes.get(
  '/segments/:id/history',
  requireAuth,
  validate({
    params: z.object({ id: z.string().regex(/^\d+$/) }),
    query: historyQuerySchema,
  }),
  asyncHandler(async (req, res) => {
    const { id } = req.params as { id: string };
    const q = query<{ from: string; to: string; bucket: string }>(req);
    const seconds = BUCKET_SECONDS[q.bucket]!;

    const rows = await sequelize.query<{
      bucket_at: Date;
      mean_speed_kph: string | null;
      vehicle_count: string | null;
      occupancy: string | null;
      samples: string;
    }>(
      `SELECT FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(observed_at) / ?) * ?) AS bucket_at,
              AVG(mean_speed_kph) AS mean_speed_kph,
              AVG(vehicle_count)  AS vehicle_count,
              AVG(occupancy)      AS occupancy,
              COUNT(*)            AS samples
       FROM traffic_readings
       WHERE segment_id = ? AND observed_at >= ? AND observed_at <= ?
       GROUP BY bucket_at
       ORDER BY bucket_at ASC`,
      {
        type: QueryTypes.SELECT,
        replacements: [seconds, seconds, id, new Date(q.from), new Date(q.to)],
      },
    );

    res.json(
      ok(
        rows.map((r) => ({
          bucketAt: new Date(r.bucket_at).toISOString(),
          meanSpeedKph: r.mean_speed_kph === null ? null : Number(r.mean_speed_kph),
          vehicleCount: r.vehicle_count === null ? null : Math.round(Number(r.vehicle_count)),
          occupancy: r.occupancy === null ? null : Number(r.occupancy),
          samples: Number(r.samples),
        })),
      ),
    );
  }),
);

// ---- device ingest ---------------------------------------------------------

const readingSchema = z.object({
  segmentId: z.string().regex(/^\d+$/),
  observedAt: z.string().datetime(),
  meanSpeedKph: z.number().min(0).max(200).nullable().optional(),
  vehicleCount: z.number().int().min(0).max(65_535).nullable().optional(),
  occupancy: z.number().min(0).max(1).nullable().optional(),
  source: z.enum(['gps', 'sensor', 'camera', 'synthetic']).default('sensor'),
});

const ingestSchema = z.object({ readings: z.array(readingSchema).min(1).max(1000) });

const MAX_FUTURE_MS = 10 * 60 * 1000;
const MAX_PAST_MS = 24 * 60 * 60 * 1000;

trafficIngestRoutes.post(
  '/traffic',
  requireApiKey('traffic:write'),
  deviceLimiter,
  validate({ body: ingestSchema }),
  asyncHandler(async (req, res) => {
    const { readings } = body<z.infer<typeof ingestSchema>>(req);
    const now = Date.now();

    const known = await sequelize.query<{ id: string }>(
      `SELECT id FROM road_segments WHERE id IN (?)`,
      { type: QueryTypes.SELECT, replacements: [[...new Set(readings.map((r) => r.segmentId))]] },
    );
    const knownIds = new Set(known.map((k) => String(k.id)));

    const rejected: Array<{ index: number; reason: string }> = [];
    const accepted: typeof readings = [];

    readings.forEach((r, index) => {
      if (!knownIds.has(r.segmentId)) {
        rejected.push({ index, reason: 'Unknown segment' });
        return;
      }
      const ts = new Date(r.observedAt).getTime();
      // design.md §7: reject readings outside the acceptable clock window.
      if (ts - now > MAX_FUTURE_MS) {
        rejected.push({ index, reason: 'observedAt is more than 10 minutes in the future' });
        return;
      }
      if (now - ts > MAX_PAST_MS) {
        rejected.push({ index, reason: 'observedAt is more than 24 hours in the past' });
        return;
      }
      accepted.push(r);
    });

    if (accepted.length > 0) {
      const placeholders = accepted.map(() => '(?, ?, ?, ?, ?, ?)').join(',');
      const reps: unknown[] = [];
      for (const r of accepted) {
        reps.push(
          r.segmentId,
          new Date(r.observedAt),
          r.meanSpeedKph ?? null,
          r.vehicleCount ?? null,
          r.occupancy ?? null,
          r.source,
        );
      }
      await sequelize.query(
        `INSERT INTO traffic_readings
           (segment_id, observed_at, mean_speed_kph, vehicle_count, occupancy, source)
         VALUES ${placeholders}`,
        { replacements: reps },
      );
    }

    res.status(201).json(ok({ accepted: accepted.length, rejected }));
  }),
);

/** Manual snapshot rebuild — used by the demo generator and by tests. */
trafficRoutes.post(
  '/snapshot',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(ok(await rebuildSnapshots()));
  }),
);
