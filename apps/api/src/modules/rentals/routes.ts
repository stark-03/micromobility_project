import { Router } from 'express';
import { z } from 'zod';
import { VEHICLE_TYPES } from '@mm/shared-types';
import { ok } from '../../lib/envelope.ts';
import { requireAuth } from '../../middleware/auth.ts';
import { asyncHandler } from '../../middleware/error.ts';
import { body, query, validate } from '../../middleware/validate.ts';
import {
  ecoSummary,
  endRental,
  estimateFare,
  getActiveRental,
  getReceipt,
  getRental,
  listPlans,
  listRentals,
  previewUnlock,
  recommendVehicles,
  retryPayment,
  startRental,
  trackRental,
} from './service.ts';
import type { TrackInput } from './service.ts';

/**
 * M14 rentals. Every route acts on the signed-in rider's own rentals; there is
 * no way to address another rider's trip, so there is nothing to authorize
 * beyond being signed in.
 */
export const rentalRoutes = Router();

rentalRoutes.use(requireAuth);

const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const idParams = z.object({ id: z.string().regex(/^\d+$/) });

rentalRoutes.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    res.json(ok([...(await listPlans()).values()]));
  }),
);

/** Quote a fare before unlocking. */
const estimateQuery = z.object({
  vehicleType: z.enum(VEHICLE_TYPES),
  distanceM: z.coerce.number().min(0).max(200_000),
  durationS: z.coerce.number().int().min(0).max(86_400).optional(),
});

rentalRoutes.get(
  '/estimate',
  validate({ query: estimateQuery }),
  asyncHandler(async (req, res) => {
    const q = query<z.infer<typeof estimateQuery>>(req);
    res.json(ok(await estimateFare(q.vehicleType, q.distanceM, q.durationS)));
  }),
);

/** Which vehicle to take, from which station, for this trip. */
rentalRoutes.post(
  '/recommend',
  validate({ body: z.object({ origin: lngLat, destination: lngLat }) }),
  asyncHandler(async (req, res) => {
    const { origin, destination } = body<{
      origin: [number, number];
      destination: [number, number];
    }>(req);
    res.json(ok(await recommendVehicles(origin, destination)));
  }),
);

const unlockCode = z
  .string()
  .trim()
  .transform((c) => c.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{8}$/, 'An unlock code is 8 letters and digits'));

/** After scanning, before unlocking: what is this vehicle and what will it cost? */
rentalRoutes.get(
  '/preview',
  validate({ query: z.object({ code: unlockCode }) }),
  asyncHandler(async (req, res) => {
    const { code } = query<{ code: string }>(req);
    res.json(ok(await previewUnlock(code)));
  }),
);

rentalRoutes.get(
  '/active',
  asyncHandler(async (req, res) => {
    res.json(ok(await getActiveRental(req.user!.id)));
  }),
);

/** Past and current rides, newest first. */
rentalRoutes.get(
  '/',
  validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }) }),
  asyncHandler(async (req, res) => {
    const { limit } = query<{ limit: number }>(req);
    res.json(ok(await listRentals(req.user!.id, limit)));
  }),
);

rentalRoutes.get(
  '/eco-summary',
  asyncHandler(async (req, res) => {
    res.json(ok(await ecoSummary(req.user!.id)));
  }),
);

/** Scan-and-go: the code from the vehicle's QR sticker starts the ride. */
rentalRoutes.post(
  '/',
  validate({
    body: z.object({ unlockCode }),
  }),
  asyncHandler(async (req, res) => {
    const { unlockCode } = body<{ unlockCode: string }>(req);
    res.status(201).json(ok(await startRental(req.user!.id, unlockCode)));
  }),
);

rentalRoutes.get(
  '/:id',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    res.json(ok(await getRental(req.user!.id, req.params.id!)));
  }),
);

/** A GPS fix from the rider's phone, or a simulated one in the demo. */
rentalRoutes.post(
  '/:id/track',
  validate({
    params: idParams,
    body: z.object({
      position: lngLat,
      speedKph: z.number().min(0).max(200).nullish(),
      accuracyM: z.number().min(0).max(10_000).nullish(),
      source: z.enum(['gps', 'simulated']).default('gps'),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(ok(await trackRental(req.user!.id, req.params.id!, body<TrackInput>(req))));
  }),
);

/** End the ride. Refused unless the vehicle is at a station with a free dock. */
rentalRoutes.post(
  '/:id/end',
  validate({ params: idParams, body: z.object({ position: lngLat.optional() }) }),
  asyncHandler(async (req, res) => {
    const { position } = body<{ position?: [number, number] }>(req);
    res.json(ok(await endRental(req.user!.id, req.params.id!, position)));
  }),
);

rentalRoutes.post(
  '/:id/pay',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    res.json(ok(await retryPayment(req.user!.id, req.params.id!)));
  }),
);

rentalRoutes.get(
  '/:id/receipt',
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    res.json(ok(await getReceipt(req.user!.id, req.params.id!)));
  }),
);
