import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../lib/envelope.ts';
import { requireAuth } from '../../middleware/auth.ts';
import { asyncHandler } from '../../middleware/error.ts';
import { requireRole } from '../../middleware/rbac.ts';
import { body, query, validate } from '../../middleware/validate.ts';
import {
  createRebalancePlan,
  getRebalancePlan,
  listRebalancePlans,
  supplyAndDemand,
  updateTaskStatus,
} from './service.ts';
import type { TaskStatus } from './service.ts';

export const fleetRoutes = Router();

fleetRoutes.use(requireAuth);

const planSchema = z.object({
  horizonHours: z.number().min(0.5).max(24).default(2),
  vanCount: z.number().int().min(0).max(50).default(2),
  vanCapacity: z.number().int().min(1).max(50).default(8),
  /** How far a van will drive to place one vehicle, in km. */
  valuePerVehicleKm: z.number().min(0).max(200).default(6),
});

fleetRoutes.get(
  '/supply-demand',
  validate({
    query: z.object({
      zoneId: z.string().regex(/^\d+$/).optional(),
      horizonHours: z.coerce.number().min(0.5).max(24).default(2),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = query<{ zoneId?: string; horizonHours: number }>(req);
    const zones = await supplyAndDemand(q.horizonHours);
    res.json(ok(q.zoneId ? zones.filter((z) => z.zoneId === q.zoneId) : zones));
  }),
);

fleetRoutes.get(
  '/rebalance/plans',
  asyncHandler(async (_req, res) => {
    res.json(ok(await listRebalancePlans()));
  }),
);

/**
 * Solving is an operational act — operators and planners, not commuters.
 * Returns the finished plan rather than a job id: the LP over eight zones
 * solves in milliseconds, so queueing it would add a poll for no benefit.
 * If the city grows to hundreds of zones this becomes a job, and the seam
 * (`jobs/runner.ts`) already exists.
 */
fleetRoutes.post(
  '/rebalance/plan',
  requireRole('operator', 'planner', 'admin'),
  validate({ body: planSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof planSchema>>(req);
    const planId = await createRebalancePlan(input, req.user!.id);
    res.status(201).json(ok(await getRebalancePlan(planId)));
  }),
);

fleetRoutes.get(
  '/rebalance/plans/:id',
  validate({ params: z.object({ id: z.string().regex(/^\d+$/) }) }),
  asyncHandler(async (req, res) => {
    res.json(ok(await getRebalancePlan(req.params.id!)));
  }),
);

fleetRoutes.patch(
  '/rebalance/tasks/:id',
  requireRole('operator', 'planner', 'admin'),
  validate({
    params: z.object({ id: z.string().regex(/^\d+$/) }),
    body: z.object({ status: z.enum(['pending', 'in_progress', 'done', 'skipped']) }),
  }),
  asyncHandler(async (req, res) => {
    const { status } = body<{ status: TaskStatus }>(req);
    await updateTaskStatus(req.params.id!, status);
    res.json(ok({ id: req.params.id, status }));
  }),
);
