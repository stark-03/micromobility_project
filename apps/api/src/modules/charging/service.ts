import { QueryTypes } from 'sequelize';
import { sequelize } from '../../db/index.ts';
import { pointLiteral, selectGeom, parsePoint } from '../../db/spatial.ts';
import { AppError } from '../../lib/errors.ts';
import type { LngLat } from '@mm/shared-types';

/**
 * Charging stations, and the two spatial questions the app asks of them:
 * "what is near this point?" and "what is near this route?"
 *
 * Both use `ST_Distance_Sphere`, which returns metres on the WGS-84 sphere.
 * Plain `ST_Distance` on SRID 4326 returns degrees, and a degree is not a
 * distance — it is ~111 km of latitude but shrinks toward the poles. Radius
 * filtering in degrees is the classic way these queries end up subtly wrong.
 */

export interface ChargingStationDto {
  id: string;
  name: string;
  zoneId: string | null;
  zoneName: string | null;
  location: LngLat;
  connectors: number;
  powerKw: number;
  status: 'active' | 'offline' | 'planned';
  notes: string | null;
  /** Present only on proximity queries. */
  distanceM?: number;
}

interface StationRow {
  id: string;
  name: string;
  zone_id: string | null;
  zone_name: string | null;
  location_wkt: string | null;
  connectors: number;
  power_kw: string;
  status: ChargingStationDto['status'];
  notes: string | null;
  distance_m?: string | null;
}

function toDto(r: StationRow): ChargingStationDto | null {
  const point = parsePoint(r.location_wkt);
  if (!point) return null;

  const dto: ChargingStationDto = {
    id: String(r.id),
    name: r.name,
    zoneId: r.zone_id === null ? null : String(r.zone_id),
    zoneName: r.zone_name,
    location: point.coordinates,
    connectors: Number(r.connectors),
    powerKw: Number(r.power_kw),
    status: r.status,
    notes: r.notes,
  };
  if (r.distance_m !== undefined && r.distance_m !== null) {
    dto.distanceM = Math.round(Number(r.distance_m));
  }
  return dto;
}

const BASE_SELECT = `
  SELECT cs.id, cs.name, cs.zone_id, z.name AS zone_name,
         ${selectGeom('cs.location', 'location_wkt')},
         cs.connectors, cs.power_kw, cs.status, cs.notes
    FROM charging_stations cs
    LEFT JOIN zones z ON z.id = cs.zone_id
   WHERE cs.deleted_at IS NULL`;

export async function listStations(): Promise<ChargingStationDto[]> {
  const rows = await sequelize.query<StationRow>(`${BASE_SELECT} ORDER BY cs.name`, {
    type: QueryTypes.SELECT,
  });
  return rows.map(toDto).filter((s): s is ChargingStationDto => s !== null);
}

/** Stations within `radiusM` of a point, nearest first. */
export async function stationsNear(
  point: LngLat,
  radiusM = 2000,
  limit = 20,
): Promise<ChargingStationDto[]> {
  const rows = await sequelize.query<StationRow>(
    `SELECT cs.id, cs.name, cs.zone_id, z.name AS zone_name,
            ${selectGeom('cs.location', 'location_wkt')},
            cs.connectors, cs.power_kw, cs.status, cs.notes,
            ST_Distance_Sphere(cs.location, ${pointLiteral(point).val}) AS distance_m
       FROM charging_stations cs
       LEFT JOIN zones z ON z.id = cs.zone_id
      WHERE cs.deleted_at IS NULL
        AND cs.status = 'active'
        AND ST_Distance_Sphere(cs.location, ${pointLiteral(point).val}) <= :radius
      ORDER BY distance_m
      LIMIT :limit`,
    { replacements: { radius: radiusM, limit }, type: QueryTypes.SELECT },
  );
  return rows.map(toDto).filter((s): s is ChargingStationDto => s !== null);
}

/**
 * Stations within `corridorM` of a planned route.
 *
 * The route arrives as its decoded geometry rather than a stored row, because a
 * plan is computed on demand and never persisted. Measuring against the whole
 * path is what makes "on the way" mean *on the way* rather than "near either
 * end" — a station 200 m from the midpoint of a 6 km ride is the one a rider
 * actually wants, and checking only origin and destination would miss it.
 *
 * **Why MULTIPOINT and not LINESTRING.** MySQL implements `ST_Distance_Sphere`
 * for Point and MultiPoint only; on an SRID 4326 LINESTRING it fails outright
 * with "has not been implemented for geographic spatial reference systems".
 * So the route is passed as its vertices and we take the distance to the
 * nearest one. That is an approximation of distance-to-the-line, and its error
 * is bounded by half the vertex spacing — the router emits a vertex roughly
 * every 35 m, so the error is under ~20 m against a corridor measured in
 * hundreds. Well inside the tolerance of "is this station on my way".
 */
export async function stationsAlongRoute(
  path: LngLat[],
  corridorM = 600,
  limit = 12,
): Promise<ChargingStationDto[]> {
  if (path.length < 2) return [];

  // Cap the vertex count so a very long route cannot build an unbounded WKT
  // literal. At 500 vertices a 20 km route still samples every ~40 m.
  const step = Math.max(1, Math.ceil(path.length / 500));
  const sampled = path.filter((_p, i) => i % step === 0 || i === path.length - 1);

  const wkt = sampled.map(([lng, lat]) => `(${lng} ${lat})`).join(',');

  const rows = await sequelize.query<StationRow>(
    `SELECT cs.id, cs.name, cs.zone_id, z.name AS zone_name,
            ${selectGeom('cs.location', 'location_wkt')},
            cs.connectors, cs.power_kw, cs.status, cs.notes,
            ST_Distance_Sphere(
              cs.location,
              ST_GeomFromText(:route, 4326, 'axis-order=long-lat')
            ) AS distance_m
       FROM charging_stations cs
       LEFT JOIN zones z ON z.id = cs.zone_id
      WHERE cs.deleted_at IS NULL
        AND cs.status = 'active'
        AND ST_Distance_Sphere(
              cs.location,
              ST_GeomFromText(:route, 4326, 'axis-order=long-lat')
            ) <= :corridor
      ORDER BY distance_m
      LIMIT :limit`,
    {
      replacements: { route: `MULTIPOINT(${wkt})`, corridor: corridorM, limit },
      type: QueryTypes.SELECT,
    },
  );
  return rows.map(toDto).filter((s): s is ChargingStationDto => s !== null);
}

export interface CreateStationInput {
  name: string;
  location: LngLat;
  connectors: number;
  powerKw: number;
  status: ChargingStationDto['status'];
  notes?: string | null;
}

export async function createStation(
  input: CreateStationInput,
  userId: string,
): Promise<ChargingStationDto> {
  // The zone is derived from the point rather than asked for: a planner
  // clicking a map should not also have to tell us which zone they clicked in,
  // and a mismatch between the two would be a bug waiting to happen.
  const [zone] = await sequelize.query<{ id: string }>(
    `SELECT id FROM zones
      WHERE ST_Contains(boundary, ${pointLiteral(input.location).val})
      LIMIT 1`,
    { type: QueryTypes.SELECT },
  );

  const [id] = await sequelize.query(
    `INSERT INTO charging_stations
       (name, zone_id, location, connectors, power_kw, status, notes, created_by)
     VALUES (:name, :zone, ${pointLiteral(input.location).val}, :connectors, :power, :status, :notes, :user)`,
    {
      replacements: {
        name: input.name,
        zone: zone?.id ?? null,
        connectors: input.connectors,
        power: input.powerKw,
        status: input.status,
        notes: input.notes ?? null,
        user: userId,
      },
    },
  );

  const created = await getStation(String(id));
  return created;
}

export async function getStation(id: string): Promise<ChargingStationDto> {
  const [row] = await sequelize.query<StationRow>(`${BASE_SELECT} AND cs.id = :id`, {
    replacements: { id },
    type: QueryTypes.SELECT,
  });
  const dto = row ? toDto(row) : null;
  if (!dto) throw new AppError('STATION_NOT_FOUND', `No charging station ${id}`);
  return dto;
}

export async function deleteStation(id: string): Promise<void> {
  await getStation(id);
  // Soft delete: a station that served trips stays referenceable in history.
  await sequelize.query(
    'UPDATE charging_stations SET deleted_at = NOW(3) WHERE id = :id AND deleted_at IS NULL',
    { replacements: { id } },
  );
}

// ---- nearby vehicles --------------------------------------------------------

export interface NearbyVehicleDto {
  id: string;
  externalRef: string;
  type: string;
  batteryPct: number | null;
  location: LngLat;
  distanceM: number;
  operatorName: string | null;
  /** Straight-line metres this vehicle can still cover, from its battery. */
  rangeM: number;
}

const MAX_RANGE_M: Record<string, number> = {
  scooter: 25000,
  ebike: 45000,
  ev: 120000,
  bike: 0,
};

/**
 * Available vehicles near a point, nearest first.
 *
 * Only `available` vehicles: one that is reserved, in use or in the workshop
 * cannot be walked to and ridden, and showing it would be a lie the rider only
 * discovers on arrival.
 */
export async function vehiclesNear(
  point: LngLat,
  radiusM = 1500,
  limit = 12,
): Promise<NearbyVehicleDto[]> {
  const rows = await sequelize.query<{
    id: string;
    external_ref: string;
    type: string;
    battery_pct: string | null;
    location_wkt: string | null;
    distance_m: string;
    operator_name: string | null;
  }>(
    `SELECT v.id, v.external_ref, v.type, v.battery_pct,
            ${selectGeom('v.last_position', 'location_wkt')},
            ST_Distance_Sphere(v.last_position, ${pointLiteral(point).val}) AS distance_m,
            o.name AS operator_name
       FROM vehicles v
       LEFT JOIN operators o ON o.id = v.operator_id
      WHERE v.deleted_at IS NULL
        AND v.status = 'available'
        AND v.last_position IS NOT NULL
        AND ST_Distance_Sphere(v.last_position, ${pointLiteral(point).val}) <= :radius
      ORDER BY distance_m
      LIMIT :limit`,
    { replacements: { radius: radiusM, limit }, type: QueryTypes.SELECT },
  );

  return rows
    .map((r) => {
      const p = parsePoint(r.location_wkt);
      if (!p) return null;
      const battery = r.battery_pct === null ? null : Number(r.battery_pct);
      const max = MAX_RANGE_M[r.type] ?? 0;

      return {
        id: String(r.id),
        externalRef: r.external_ref,
        type: r.type,
        batteryPct: battery,
        location: p.coordinates,
        distanceM: Math.round(Number(r.distance_m)),
        operatorName: r.operator_name,
        // A pedal bike has no battery and no range limit worth reporting.
        rangeM: max === 0 ? 0 : Math.round(((battery ?? 0) / 100) * max),
      } satisfies NearbyVehicleDto;
    })
    .filter((v): v is NearbyVehicleDto => v !== null);
}
