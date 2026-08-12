import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../lib/envelope.ts';
import { requireAuth } from '../../middleware/auth.ts';
import { asyncHandler } from '../../middleware/error.ts';
import { requireRole } from '../../middleware/rbac.ts';
import { query, validate } from '../../middleware/validate.ts';
import { enqueue } from '../../jobs/runner.ts';
import { forecastDemand, listModels } from './service.ts';

export const predictionRoutes = Router();

predictionRoutes.use(requireAuth);

const demandQuery = z.object({
  zoneId: z.string().regex(/^\d+$/).optional(),
  horizon: z.coerce.number().int().min(1).max(24).default(4),
});

/** Public passthrough (MODULES.md M05). */
predictionRoutes.get(
  '/demand',
  validate({ query: demandQuery }),
  asyncHandler(async (req, res) => {
    const q = query<{ zoneId?: string; horizon: number }>(req);
    const forecasts = await forecastDemand(q.horizon);
    res.json(ok(q.zoneId ? forecasts.filter((f) => f.zoneId === q.zoneId) : forecasts));
  }),
);

/** The model registry — an analyst screen reads this. */
predictionRoutes.get(
  '/models',
  asyncHandler(async (_req, res) => {
    res.json(ok(await listModels()));
  }),
);

/**
 * Queues training. Returns a jobId, never the result.
 *
 * CLAUDE.md: training is always a job, never a request handler. A fit over six
 * weeks of history takes far longer than any sane HTTP timeout.
 */
predictionRoutes.post(
  '/train',
  requireRole('admin', 'analyst'),
  asyncHandler(async (_req, res) => {
    const jobId = await enqueue('train-demand', {});
    res.status(202).json(ok({ jobId, status: 'queued' }));
  }),
);
