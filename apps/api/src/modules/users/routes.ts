import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.ts';
import { asyncHandler } from '../../middleware/error.ts';
import { validate } from '../../middleware/validate.ts';
import {
  deleteMyPlace,
  getMe,
  getMyPlaces,
  getMyPreferences,
  getMyTrips,
  patchMe,
  patchMyPlace,
  patchMyPreferences,
  postMyPlace,
} from './controller.ts';
import {
  createPlaceSchema,
  feedQuerySchema,
  idParamSchema,
  updateMeSchema,
  updatePlaceSchema,
  updatePreferencesSchema,
} from './dto.ts';

export const userRoutes = Router();

// Every route here is the caller's own data; no role gate beyond being signed in.
userRoutes.use(requireAuth);

userRoutes.get('/me', asyncHandler(getMe));
userRoutes.patch('/me', validate({ body: updateMeSchema }), asyncHandler(patchMe));

userRoutes.get('/me/preferences', asyncHandler(getMyPreferences));
userRoutes.patch(
  '/me/preferences',
  validate({ body: updatePreferencesSchema }),
  asyncHandler(patchMyPreferences),
);

userRoutes.get('/me/places', asyncHandler(getMyPlaces));
userRoutes.post('/me/places', validate({ body: createPlaceSchema }), asyncHandler(postMyPlace));
userRoutes.patch(
  '/me/places/:id',
  validate({ params: idParamSchema, body: updatePlaceSchema }),
  asyncHandler(patchMyPlace),
);
userRoutes.delete(
  '/me/places/:id',
  validate({ params: idParamSchema }),
  asyncHandler(deleteMyPlace),
);

userRoutes.get('/me/trips', validate({ query: feedQuerySchema }), asyncHandler(getMyTrips));
