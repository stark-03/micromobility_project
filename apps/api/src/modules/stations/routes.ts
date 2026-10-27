import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../lib/envelope.ts';
import { requireAuth } from '../../middleware/auth.ts';
import { asyncHandler } from '../../middleware/error.ts';
import { requireRole } from '../../middleware/rbac.ts';
import { body, query, validate } from '../../middleware/validate.ts';
import { createStation, getStation, listStations, stationsNear } from './service.ts';
import type { CreateStationInput } from './service.ts';

export const stationRoutes = Router();

stationRoutes.use(requireAuth);

const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

const nearQuery = z.object({
  lng: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  radiusM: z.coerce.number().min(50).max(20000).default(2000),
});

stationRoutes.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(ok(await listStations()));
  }),
);

/** Stations near the rider, with how many of each vehicle type they can rent. */
stationRoutes.get(
  '/near',
  validate({ query: nearQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof nearQuery>>(req);
    res.json(ok(await stationsNear([q.lng, q.lat], q.radiusM)));
  }),
);

stationRoutes.get(
  '/:id',
  validate({ params: z.object({ id: z.string().regex(/^\d+$/) }) }),
  asyncHandler(async (req, res) => {
    res.json(ok(await getStation(req.params.id!)));
  }),
);

// Siting a station is a planning decision, like siting a charger.
stationRoutes.post(
  '/',
  requireRole('planner', 'admin'),
  validate({
    body: z.object({
      code: z
        .string()
        .trim()
        .regex(/^[A-Z0-9-]{2,16}$/),
      name: z.string().trim().min(2).max(120),
      location: lngLat,
      capacity: z.number().int().min(1).max(200).default(12),
      returnRadiusM: z.number().int().min(20).max(500).default(150),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.status(201).json(ok(await createStation(body<CreateStationInput>(req))));
  }),
);
