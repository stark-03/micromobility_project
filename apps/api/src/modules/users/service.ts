import { QueryTypes } from 'sequelize';
import type { SavedPlaceDto, TripDto } from '@mm/shared-types';
import { sequelize } from '../../db/index.ts';
import { SavedPlace, User, UserPreference } from '../../db/models/index.ts';
import { pointLiteral, selectGeom } from '../../db/spatial.ts';
import { decodeCursor, encodeCursor } from '../../lib/cursor.ts';
import { AppError } from '../../lib/errors.ts';
import type {
  CreatePlaceInput,
  FeedQuery,
  TripRow,
  UpdateMeInput,
  UpdatePlaceInput,
  UpdatePreferencesInput,
} from './dto.ts';
import { toPlaceDto, toTripDto } from './dto.ts';

export async function getUser(userId: string): Promise<User> {
  const user = await User.findByPk(userId);
  if (!user) throw AppError.notFound('USER_NOT_FOUND', 'User not found');
  return user;
}

export async function updateMe(userId: string, input: UpdateMeInput): Promise<User> {
  const user = await getUser(userId);
  if (input.fullName !== undefined) user.full_name = input.fullName;
  if (input.phone !== undefined) user.phone = input.phone;
  await user.save();
  return user;
}

export async function getPreferences(userId: string): Promise<UserPreference> {
  const [prefs] = await UserPreference.findOrCreate({
    where: { user_id: userId },
    defaults: { user_id: userId },
  });
  return prefs;
}

export async function updatePreferences(
  userId: string,
  input: UpdatePreferencesInput,
): Promise<UserPreference> {
  const prefs = await getPreferences(userId);
  if (input.language !== undefined) prefs.language = input.language;
  if (input.units !== undefined) prefs.units = input.units;
  if (input.preferredVehicleType !== undefined) {
    prefs.preferred_vehicle_type = input.preferredVehicleType;
  }
  if (input.theme !== undefined) prefs.theme = input.theme;
  if (input.notificationsEnabled !== undefined) {
    prefs.notifications_enabled = input.notificationsEnabled;
  }
  await prefs.save();
  return prefs;
}

// ---- saved places ----------------------------------------------------------
// `position` is NOT NULL POINT, so these go through raw SQL and spatial.ts
// rather than the model. See models/saved-place.ts.

interface PlaceRow {
  id: string;
  wkt: string | null;
}

export async function listPlaces(userId: string): Promise<SavedPlaceDto[]> {
  const places = await SavedPlace.findAll({
    where: { user_id: userId },
    order: [['created_at', 'DESC']],
  });
  if (places.length === 0) return [];

  const rows = await sequelize.query<PlaceRow>(
    `SELECT id, ${selectGeom('position', 'wkt')} FROM saved_places WHERE user_id = ?`,
    { type: QueryTypes.SELECT, replacements: [userId] },
  );
  const wktById = new Map(rows.map((r) => [String(r.id), r.wkt]));

  return places.map((p) => toPlaceDto(p, wktById.get(String(p.id)) ?? null));
}

export async function createPlace(
  userId: string,
  input: CreatePlaceInput,
): Promise<SavedPlaceDto> {
  const existing = await SavedPlace.findOne({ where: { user_id: userId, label: input.label } });
  if (existing) {
    throw AppError.conflict(
      'SAVED_PLACE_LABEL_EXISTS',
      `You already have a place labelled "${input.label}"`,
    );
  }

  const [id] = await sequelize.query(
    `INSERT INTO saved_places (user_id, label, address, kind, position)
     VALUES (?, ?, ?, ?, ${pointLiteral(input.position).val as string})`,
    { replacements: [userId, input.label, input.address ?? null, input.kind] },
  );

  const place = await SavedPlace.findByPk(String(id));
  if (!place) throw new Error('Saved place vanished immediately after insert');

  const rows = await sequelize.query<PlaceRow>(
    `SELECT id, ${selectGeom('position', 'wkt')} FROM saved_places WHERE id = ?`,
    { type: QueryTypes.SELECT, replacements: [place.id] },
  );
  return toPlaceDto(place, rows[0]?.wkt ?? null);
}

async function ownedPlace(userId: string, placeId: string): Promise<SavedPlace> {
  const place = await SavedPlace.findOne({ where: { id: placeId, user_id: userId } });
  // 404 rather than 403 for someone else's place: a 403 would confirm the id
  // exists, which leaks the existence of other users' data.
  if (!place) throw AppError.notFound('SAVED_PLACE_NOT_FOUND', 'Saved place not found');
  return place;
}

export async function updatePlace(
  userId: string,
  placeId: string,
  input: UpdatePlaceInput,
): Promise<SavedPlaceDto> {
  const place = await ownedPlace(userId, placeId);

  if (input.label !== undefined) place.label = input.label;
  if (input.address !== undefined) place.address = input.address;
  if (input.kind !== undefined) place.kind = input.kind;
  await place.save();

  if (input.position) {
    await sequelize.query(
      `UPDATE saved_places SET position = ${pointLiteral(input.position).val as string} WHERE id = ?`,
      { replacements: [place.id] },
    );
  }

  const rows = await sequelize.query<PlaceRow>(
    `SELECT id, ${selectGeom('position', 'wkt')} FROM saved_places WHERE id = ?`,
    { type: QueryTypes.SELECT, replacements: [place.id] },
  );
  return toPlaceDto(place, rows[0]?.wkt ?? null);
}

export async function deletePlace(userId: string, placeId: string): Promise<void> {
  const place = await ownedPlace(userId, placeId);
  await place.destroy();
}

// ---- travel history --------------------------------------------------------

export interface TripPage {
  trips: TripDto[];
  nextCursor: string | null;
}

export async function listTrips(userId: string, q: FeedQuery): Promise<TripPage> {
  const where: string[] = ['user_id = ?'];
  const replacements: unknown[] = [userId];

  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    // Keyset on (started_at, id): the id breaks ties so rows sharing a
    // millisecond are never skipped or repeated across pages.
    where.push('(started_at < ? OR (started_at = ? AND id < ?))');
    replacements.push(c.ts, c.ts, c.id);
  }

  // Fetch one extra to learn whether another page exists.
  replacements.push(q.limit + 1);

  const rows = await sequelize.query<TripRow>(
    `SELECT id, public_ref, vehicle_id, operator_id, start_zone_id, end_zone_id,
            started_at, ended_at, distance_m, duration_s, status,
            ${selectGeom('start_position', 'start_wkt')},
            ${selectGeom('end_position', 'end_wkt')}
     FROM trips
     WHERE ${where.join(' AND ')}
     ORDER BY started_at DESC, id DESC
     LIMIT ?`,
    { type: QueryTypes.SELECT, replacements },
  );

  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  const last = page[page.length - 1];

  return {
    trips: page.map(toTripDto),
    nextCursor:
      hasMore && last
        ? encodeCursor({ id: String(last.id), ts: new Date(last.started_at).toISOString() })
        : null,
  };
}
