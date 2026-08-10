import { Router } from 'express';
import { QueryTypes } from 'sequelize';
import { z } from 'zod';
import { sequelize } from '../../db/index.ts';
import { ok } from '../../lib/envelope.ts';
import { requireAuth } from '../../middleware/auth.ts';
import { asyncHandler } from '../../middleware/error.ts';
import { query, validate } from '../../middleware/validate.ts';
import { getCurrentWeather, pollWeather } from './service.ts';

export const weatherRoutes = Router();

weatherRoutes.use(requireAuth);

const currentSchema = z.object({ zoneId: z.string().regex(/^\d+$/).optional() });

weatherRoutes.get(
  '/current',
  validate({ query: currentSchema }),
  asyncHandler(async (req, res) => {
    const { zoneId } = query<{ zoneId?: string }>(req);
    res.json(ok(await getCurrentWeather(zoneId)));
  }),
);

const forecastSchema = z.object({
  zoneId: z.string().regex(/^\d+$/),
  hours: z.coerce.number().int().min(1).max(72).default(12),
});

weatherRoutes.get(
  '/forecast',
  validate({ query: forecastSchema }),
  asyncHandler(async (req, res) => {
    const q = query<{ zoneId: string; hours: number }>(req);
    const rows = await sequelize.query<{
      forecast_for: Date;
      temp_c: string | null;
      precipitation_mm: string | null;
      wind_kph: string | null;
      condition_code: string | null;
    }>(
      `SELECT forecast_for, temp_c, precipitation_mm, wind_kph, condition_code
       FROM weather_forecasts
       WHERE zone_id = ? AND forecast_for BETWEEN NOW(3) AND DATE_ADD(NOW(3), INTERVAL ? HOUR)
       ORDER BY forecast_for ASC`,
      { type: QueryTypes.SELECT, replacements: [q.zoneId, q.hours] },
    );

    res.json(
      ok(
        rows.map((r) => ({
          forecastFor: new Date(r.forecast_for).toISOString(),
          tempC: r.temp_c === null ? null : Number(r.temp_c),
          precipitationMm: r.precipitation_mm === null ? null : Number(r.precipitation_mm),
          windKph: r.wind_kph === null ? null : Number(r.wind_kph),
          conditionCode: r.condition_code,
        })),
      ),
    );
  }),
);

/** Manual poll — used by the demo script and by tests. */
weatherRoutes.post(
  '/poll',
  asyncHandler(async (_req, res) => {
    res.json(ok(await pollWeather()));
  }),
);
