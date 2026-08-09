import type { Request, Response } from 'express';
import { ok } from '../../lib/envelope.ts';
import { AppError } from '../../lib/errors.ts';
import { body, params, query } from '../../middleware/validate.ts';
import { getUserRoles } from '../auth/service.ts';
import { toUserDto } from '../auth/dto.ts';
import { toPreferencesDto } from './dto.ts';
import type {
  CreatePlaceInput,
  FeedQuery,
  UpdateMeInput,
  UpdatePlaceInput,
  UpdatePreferencesInput,
} from './dto.ts';
import {
  createPlace,
  deletePlace,
  getPreferences,
  getUser,
  listPlaces,
  listTrips,
  updateMe,
  updatePlace,
  updatePreferences,
} from './service.ts';

function actor(req: Request): string {
  if (!req.user) throw AppError.unauthenticated();
  return req.user.id;
}

export async function getMe(req: Request, res: Response): Promise<void> {
  const id = actor(req);
  const user = await getUser(id);
  res.json(ok(toUserDto(user, await getUserRoles(id))));
}

export async function patchMe(req: Request, res: Response): Promise<void> {
  const id = actor(req);
  const user = await updateMe(id, body<UpdateMeInput>(req));
  res.json(ok(toUserDto(user, await getUserRoles(id))));
}

export async function getMyPreferences(req: Request, res: Response): Promise<void> {
  res.json(ok(toPreferencesDto(await getPreferences(actor(req)))));
}

export async function patchMyPreferences(req: Request, res: Response): Promise<void> {
  const prefs = await updatePreferences(actor(req), body<UpdatePreferencesInput>(req));
  res.json(ok(toPreferencesDto(prefs)));
}

export async function getMyPlaces(req: Request, res: Response): Promise<void> {
  res.json(ok(await listPlaces(actor(req))));
}

export async function postMyPlace(req: Request, res: Response): Promise<void> {
  const place = await createPlace(actor(req), body<CreatePlaceInput>(req));
  res.status(201).json(ok(place));
}

export async function patchMyPlace(req: Request, res: Response): Promise<void> {
  const { id } = params<{ id: string }>(req);
  res.json(ok(await updatePlace(actor(req), id, body<UpdatePlaceInput>(req))));
}

export async function deleteMyPlace(req: Request, res: Response): Promise<void> {
  const { id } = params<{ id: string }>(req);
  await deletePlace(actor(req), id);
  res.status(204).send();
}

export async function getMyTrips(req: Request, res: Response): Promise<void> {
  const q = query<FeedQuery>(req);
  const page = await listTrips(actor(req), q);
  res.json(ok(page.trips, { limit: q.limit, nextCursor: page.nextCursor }));
}
