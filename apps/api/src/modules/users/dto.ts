import { z } from 'zod';
import { VEHICLE_TYPES } from '@mm/shared-types';
import type { SavedPlaceDto, TripDto, UserPreferencesDto } from '@mm/shared-types';
import type { SavedPlace, Trip, UserPreference } from '../../db/models/index.ts';
import { parsePoint } from '../../db/spatial.ts';

/** Only these two are editable. Email, status, roles and operator are not. */
export const updateMeSchema = z
  .object({
    fullName: z.string().min(2).max(120).trim().optional(),
    phone: z.string().min(6).max(32).trim().nullable().optional(),
  })
  .strict();

export const updatePreferencesSchema = z
  .object({
    language: z.string().min(2).max(8).optional(),
    units: z.enum(['metric', 'imperial']).optional(),
    preferredVehicleType: z.enum(VEHICLE_TYPES).nullable().optional(),
    theme: z.enum(['dark', 'light']).optional(),
    notificationsEnabled: z.boolean().optional(),
  })
  .strict();

const lngLat = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

export const createPlaceSchema = z.object({
  label: z.string().min(1).max(80).trim(),
  address: z.string().max(255).trim().nullable().optional(),
  kind: z.enum(['home', 'work', 'other']).default('other'),
  /** [lng, lat] — the order used everywhere in this codebase. */
  position: lngLat,
});

export const updatePlaceSchema = z
  .object({
    label: z.string().min(1).max(80).trim().optional(),
    address: z.string().max(255).trim().nullable().optional(),
    kind: z.enum(['home', 'work', 'other']).optional(),
    position: lngLat.optional(),
  })
  .strict();

export const idParamSchema = z.object({ id: z.string().regex(/^\d+$/, 'Must be a numeric id') });

export const feedQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
export type CreatePlaceInput = z.infer<typeof createPlaceSchema>;
export type UpdatePlaceInput = z.infer<typeof updatePlaceSchema>;
export type FeedQuery = z.infer<typeof feedQuerySchema>;

export function toPreferencesDto(p: UserPreference): UserPreferencesDto {
  return {
    language: p.language,
    units: p.units,
    preferredVehicleType: p.preferred_vehicle_type ?? null,
    theme: p.theme,
    notificationsEnabled: Boolean(p.notifications_enabled),
  };
}

export function toPlaceDto(p: SavedPlace, positionWkt: string | null): SavedPlaceDto {
  const position = parsePoint(positionWkt);
  if (!position) throw new Error(`Saved place ${p.id} has no position`);
  return {
    id: String(p.id),
    label: p.label,
    address: p.address ?? null,
    kind: p.kind,
    position,
    createdAt: p.created_at.toISOString(),
  };
}

export interface TripRow {
  id: string;
  public_ref: string;
  vehicle_id: string;
  operator_id: string;
  start_zone_id: string | null;
  end_zone_id: string | null;
  started_at: Date;
  ended_at: Date | null;
  distance_m: string | null;
  duration_s: number | null;
  status: 'active' | 'completed' | 'cancelled';
  start_wkt: string | null;
  end_wkt: string | null;
}

export function toTripDto(r: TripRow): TripDto {
  return {
    id: String(r.id),
    publicRef: r.public_ref,
    vehicleId: String(r.vehicle_id),
    operatorId: String(r.operator_id),
    startZoneId: r.start_zone_id === null ? null : String(r.start_zone_id),
    endZoneId: r.end_zone_id === null ? null : String(r.end_zone_id),
    startedAt: new Date(r.started_at).toISOString(),
    endedAt: r.ended_at === null ? null : new Date(r.ended_at).toISOString(),
    startPosition: parsePoint(r.start_wkt),
    endPosition: parsePoint(r.end_wkt),
    // DECIMAL arrives from mysql2 as a string; convert at the boundary so no
    // consumer receives a string where the contract promises a number.
    distanceM: r.distance_m === null ? null : Number(r.distance_m),
    durationS: r.duration_s === null ? null : Number(r.duration_s),
    status: r.status,
  };
}

export type { Trip };
