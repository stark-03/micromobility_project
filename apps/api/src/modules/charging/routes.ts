import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../lib/envelope.ts';
import { requireAuth } from '../../middleware/auth.ts';
import { asyncHandler } from '../../middleware/error.ts';
import { requireRole } from '../../middleware/rbac.ts';
import { body, query, validate } from '../../middleware/validate.ts';
import {
  createStation,
  deleteStation,
  getStation,
  listStations,
  stationsAlongRoute,
  stationsNear,
  vehiclesNear,
} from './service.ts';

export const chargingRoutes = Router();

chargingRoutes.use(requireAuth);

/** [lng, lat] — the order everything in this codebase speaks. */
const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

const nearQuery = z.object({
  lng: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  radiusM: z.coerce.number().min(50).max(20000).default(2000),
});

chargingRoutes.get(
  '/stations',
  asyncHandler(async (_req, res) => {
    res.json(ok(await listStations()));
  }),
);

chargingRoutes.get(
  '/stations/near',
  validate({ query: nearQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof nearQuery>>(req);
    res.json(ok(await stationsNear([q.lng, q.lat], q.radiusM)));
  }),
);

/**
 * Stations along a planned route.
 *
 * POST rather than GET because the route geometry is hundreds of coordinate
 * pairs — far past what belongs in a query string, and past what some proxies
 * will carry.
 */
chargingRoutes.post(
  '/stations/along-route',
  validate({
    body: z.object({
      path: z.array(lngLat).min(2).max(5000),
      corridorM: z.number().min(50).max(5000).default(600),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { path, corridorM } = body<{ path: [number, number][]; corridorM: number }>(req);
    res.json(ok(await stationsAlongRoute(path, corridorM)));
  }),
);

// Placing infrastructure is a planning act.
chargingRoutes.post(
  '/stations',
  requireRole('planner', 'admin'),
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(120),
      location: lngLat,
      connectors: z.number().int().min(1).max(64).default(4),
      powerKw: z.number().min(0.5).max(400).default(3.3),
      status: z.enum(['active', 'offline', 'planned']).default('active'),
      notes: z.string().trim().max(255).nullish(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const input = body<Parameters<typeof createStation>[0]>(req);
    res.status(201).json(ok(await createStation(input, req.user!.id)));
  }),
);

chargingRoutes.get(
  '/stations/:id',
  validate({ params: z.object({ id: z.string().regex(/^\d+$/) }) }),
  asyncHandler(async (req, res) => {
    res.json(ok(await getStation(req.params.id!)));
  }),
);

chargingRoutes.delete(
  '/stations/:id',
  requireRole('planner', 'admin'),
  validate({ params: z.object({ id: z.string().regex(/^\d+$/) }) }),
  asyncHandler(async (req, res) => {
    await deleteStation(req.params.id!);
    res.status(204).end();
  }),
);

/** Available vehicles near a point — what a rider standing there can take. */
chargingRoutes.get(
  '/vehicles/near',
  validate({ query: nearQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof nearQuery>>(req);
    res.json(ok(await vehiclesNear([q.lng, q.lat], q.radiusM)));
  }),
);
