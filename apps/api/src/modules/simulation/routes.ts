import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../lib/envelope.ts';
import { requireAuth } from '../../middleware/auth.ts';
import { asyncHandler } from '../../middleware/error.ts';
import { requireRole } from '../../middleware/rbac.ts';
import { body, query, validate } from '../../middleware/validate.ts';
import {
  compareRuns,
  createScenario,
  deleteScenario,
  getRun,
  getTimeline,
  listRuns,
  listScenarios,
  queueRun,
  setBaseline,
} from './service.ts';

export const simulationRoutes = Router();
export const runRoutes = Router();

simulationRoutes.use(requireAuth);
runRoutes.use(requireAuth);

const fleetSchema = z.object({
  scooter: z.number().int().min(0).max(5000),
  ebike: z.number().int().min(0).max(5000),
  bike: z.number().int().min(0).max(5000),
});

const weatherSchema = z.object({
  precipitationMm: z.number().min(0).max(200),
  tempC: z.number().min(-20).max(60),
});

/**
 * The levers, bounded. These ranges are the same ones the ML service's pydantic
 * model enforces — validating here as well means a bad scenario is rejected at
 * the boundary with a proper error envelope, rather than surfacing as a failed
 * run five seconds later with a pydantic traceback in the error column.
 */
const policySchema = z.object({
  bikeLaneZones: z.array(z.string()).max(200).default([]),
  closedZones: z.array(z.string()).max(200).default([]),
  demandMultiplier: z.number().min(0).max(5).default(1),
  rebalanceEnabled: z.boolean().default(false),
  rebalanceIntervalMin: z.number().int().min(5).max(720).default(60),
  rebalanceVanCapacity: z.number().int().min(1).max(50).default(8),
});

const createScenarioSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullish(),
  simHours: z.number().min(0.5).max(168).default(24),
  startHour: z.number().min(0).max(23.99).default(0),
  fleet: fleetSchema,
  weather: weatherSchema.default({ precipitationMm: 0, tempC: 27 }),
  policy: policySchema.default({}),
});

const idParam = z.object({ id: z.string().regex(/^\d+$/) });
const runIdParam = z.object({ runId: z.string().regex(/^\d+$/) });

// ---- scenarios --------------------------------------------------------------

simulationRoutes.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(ok(await listScenarios()));
  }),
);

// Building a scenario is a planning act, not an operational one: planners and
// admins only. A commuter has no business defining city policy.
simulationRoutes.post(
  '/',
  requireRole('planner', 'admin'),
  validate({ body: createScenarioSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof createScenarioSchema>>(req);
    const scenario = await createScenario(
      { ...input, description: input.description ?? null },
      req.user!.id,
    );
    res.status(201).json(ok(scenario));
  }),
);

simulationRoutes.delete(
  '/:id',
  requireRole('planner', 'admin'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    await deleteScenario(req.params.id!);
    res.status(204).end();
  }),
);

/** Queues a run. 202 with a `queued` run — never the result. */
simulationRoutes.post(
  '/:id/runs',
  requireRole('planner', 'admin'),
  validate({ params: idParam, body: z.object({ seed: z.number().int().min(0).max(2 ** 31 - 1).optional() }).default({}) }),
  asyncHandler(async (req, res) => {
    const { seed } = body<{ seed?: number }>(req);
    const run = await queueRun(req.params.id!, req.user!.id, seed);
    res.status(202).json(ok(run));
  }),
);

simulationRoutes.get(
  '/:id/runs',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    res.json(ok(await listRuns(req.params.id!)));
  }),
);

simulationRoutes.post(
  '/:id/baseline',
  requireRole('planner', 'admin'),
  validate({ params: idParam, body: z.object({ runId: z.string().regex(/^\d+$/) }) }),
  asyncHandler(async (req, res) => {
    const { runId } = body<{ runId: string }>(req);
    await setBaseline(req.params.id!, runId);
    res.json(ok({ scenarioId: req.params.id, baselineRunId: runId }));
  }),
);

// ---- runs -------------------------------------------------------------------

runRoutes.get(
  '/',
  validate({ query: z.object({ scenarioId: z.string().regex(/^\d+$/).optional() }) }),
  asyncHandler(async (req, res) => {
    const q = query<{ scenarioId?: string }>(req);
    res.json(ok(await listRuns(q.scenarioId)));
  }),
);

/**
 * Compare is declared before `/:runId` on purpose. Express matches in order, so
 * a parameterised route registered first would swallow `/compare` and try to
 * look up a run with that id.
 */
runRoutes.post(
  '/compare',
  validate({
    body: z.object({
      runIds: z.array(z.string().regex(/^\d+$/)).length(2),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { runIds } = body<{ runIds: [string, string] }>(req);
    res.json(ok(await compareRuns(runIds[0], runIds[1])));
  }),
);

runRoutes.get(
  '/:runId',
  validate({ params: runIdParam }),
  asyncHandler(async (req, res) => {
    res.json(ok(await getRun(req.params.runId!)));
  }),
);

runRoutes.get(
  '/:runId/timeline',
  validate({ params: runIdParam }),
  asyncHandler(async (req, res) => {
    res.json(ok(await getTimeline(req.params.runId!)));
  }),
);
