import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../../lib/envelope.ts';
import { requireAuth } from '../../middleware/auth.ts';
import { asyncHandler } from '../../middleware/error.ts';
import { body, validate } from '../../middleware/validate.ts';
import { compareRoutes, planRoute } from './service.ts';

export const routeRoutes = Router();

routeRoutes.use(requireAuth);

const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

const planSchema = z.object({
  origin: lngLat,
  destination: lngLat,
  mode: z.enum(['scooter', 'bike', 'ebike', 'ev']).default('scooter'),
  profile: z.enum(['fastest', 'safest', 'greenest']).default('fastest'),
});

const compareSchema = z.object({
  origin: lngLat,
  destination: lngLat,
  mode: z.enum(['scooter', 'bike', 'ebike', 'ev']).default('scooter'),
});

routeRoutes.post(
  '/plan',
  validate({ body: planSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof planSchema>>(req);
    res.json(ok(await planRoute(input)));
  }),
);

/** All three profiles at once — the comparison is the point of the screen. */
routeRoutes.post(
  '/compare',
  validate({ body: compareSchema }),
  asyncHandler(async (req, res) => {
    const input = body<z.infer<typeof compareSchema>>(req);
    res.json(ok(await compareRoutes(input)));
  }),
);
