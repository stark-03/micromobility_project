import { QueryTypes } from 'sequelize';
import type { Transaction } from 'sequelize';
import { VEHICLE_TYPES } from '@mm/shared-types';
import type {
  LngLat,
  RentalStationDetailDto,
  RentalStationDto,
  StationInventoryDto,
  StationVehicleDto,
  VehicleStatus,
  VehicleType,
} from '@mm/shared-types';
import { sequelize } from '../../db/index.ts';
import { parsePoint, pointLiteral, selectGeom } from '../../db/spatial.ts';
import { AppError } from '../../lib/errors.ts';
import { batteryFor, isRentable, MIN_RENTABLE_BATTERY_PCT } from '../rentals/specs.ts';

/**
 * M08 rental stations.
 *
 * Inventory is computed from `vehicles` on every read — see migration 28. A
 * vehicle "is at" a station when its `station_id` points there; renting clears
 * it, a verified return sets it. Charging and maintenance leave it in place,
 * which is right: the vehicle is physically still in the dock, just not
 * rentable, and it still takes up a dock a returning rider cannot use.
 */

interface StationRow {
  id: string;
  code: string;
  name: string;
  zone_name: string | null;
  location_wkt: string | null;
  capacity: number;
  return_radius_m: number;
  status: 'active' | 'closed';
  distance_m?: string | null;
}

interface CountRow {
  station_id: string;
  type: VehicleType;
  rentable: string;
  unavailable: string;
}

/** Vehicles that occupy a dock: everything at the station except a retired one. */
const DOCKED = `v.deleted_at IS NULL AND v.status <> 'retired'`;

/** SQL twin of specs.isRentable(). Keep them in step. */
const RENTABLE_SQL = `(v.status = 'available'
  AND (v.type = 'bike' OR COALESCE(v.battery_pct, 0) >= ${MIN_RENTABLE_BATTERY_PCT}))`;

function selectStations(distanceFrom?: LngLat): string {
  const distance = distanceFrom
    ? `, ST_Distance_Sphere(rs.location, ${pointLiteral(distanceFrom).val}) AS distance_m`
    : '';
  return `
    SELECT rs.id, rs.code, rs.name, z.name AS zone_name,
           ${selectGeom('rs.location', 'location_wkt')},
           rs.capacity, rs.return_radius_m, rs.status ${distance}
      FROM rental_stations rs
      LEFT JOIN zones z ON z.id = rs.zone_id
     WHERE rs.deleted_at IS NULL`;
}

async function countsFor(ids: string[], t?: Transaction): Promise<Map<string, CountRow[]>> {
  const out = new Map<string, CountRow[]>();
  if (ids.length === 0) return out;

  const rows = await sequelize.query<CountRow>(
    `SELECT v.station_id, v.type,
            SUM(${RENTABLE_SQL})     AS rentable,
            SUM(NOT ${RENTABLE_SQL}) AS unavailable
       FROM vehicles v
      WHERE v.station_id IN (:ids) AND ${DOCKED}
      GROUP BY v.station_id, v.type`,
    { replacements: { ids }, type: QueryTypes.SELECT, transaction: t },
  );
  for (const r of rows) {
    const key = String(r.station_id);
    out.set(key, [...(out.get(key) ?? []), r]);
  }
  return out;
}

function toDto(r: StationRow, counts: CountRow[]): RentalStationDto {
  const point = parsePoint(r.location_wkt);
  if (!point) throw new Error(`Rental station ${r.id} has no location`);

  // Every type, in a fixed order, even at zero — "0 e-bikes" is an answer.
  const inventory: StationInventoryDto[] = VEHICLE_TYPES.map((type) => {
    const c = counts.find((x) => x.type === type);
    return {
      type,
      rentable: Number(c?.rentable ?? 0),
      unavailable: Number(c?.unavailable ?? 0),
    };
  });
  const docked = inventory.reduce((n, i) => n + i.rentable + i.unavailable, 0);

  const dto: RentalStationDto = {
    id: String(r.id),
    code: r.code,
    name: r.name,
    zoneName: r.zone_name,
    location: point.coordinates,
    capacity: Number(r.capacity),
    freeDocks: Math.max(0, Number(r.capacity) - docked),
    status: r.status,
    inventory,
    rentableTotal: inventory.reduce((n, i) => n + i.rentable, 0),
  };
  if (r.distance_m !== undefined && r.distance_m !== null) {
    dto.distanceM = Math.round(Number(r.distance_m));
  }
  return dto;
}

async function hydrate(rows: StationRow[], t?: Transaction): Promise<RentalStationDto[]> {
  const counts = await countsFor(
    rows.map((r) => String(r.id)),
    t,
  );
  return rows.map((r) => toDto(r, counts.get(String(r.id)) ?? []));
}

export async function listStations(): Promise<RentalStationDto[]> {
  const rows = await sequelize.query<StationRow>(`${selectStations()} ORDER BY rs.name`, {
    type: QueryTypes.SELECT,
  });
  return hydrate(rows);
}

/** Active stations within `radiusM` of a point, nearest first. */
export async function stationsNear(
  point: LngLat,
  radiusM = 2000,
  limit = 20,
): Promise<RentalStationDto[]> {
  const rows = await sequelize.query<StationRow>(
    `${selectStations(point)}
       AND rs.status = 'active'
       AND ST_Distance_Sphere(rs.location, ${pointLiteral(point).val}) <= :radius
     ORDER BY distance_m
     LIMIT :limit`,
    { replacements: { radius: radiusM, limit }, type: QueryTypes.SELECT },
  );
  return hydrate(rows);
}

interface VehicleRow {
  id: string;
  station_id: string;
  external_ref: string;
  unlock_code: string | null;
  type: VehicleType;
  status: VehicleStatus;
  battery_pct: number | null;
}

async function vehiclesAt(ids: string[]): Promise<Map<string, StationVehicleDto[]>> {
  const out = new Map<string, StationVehicleDto[]>();
  if (ids.length === 0) return out;

  const rows = await sequelize.query<VehicleRow>(
    `SELECT v.id, v.station_id, v.external_ref, v.unlock_code, v.type, v.status, v.battery_pct
       FROM vehicles v
      WHERE v.station_id IN (:ids) AND ${DOCKED}
      ORDER BY v.type, v.battery_pct DESC`,
    { replacements: { ids }, type: QueryTypes.SELECT },
  );
  for (const r of rows) {
    const battery = r.battery_pct === null ? null : Number(r.battery_pct);
    const dto: StationVehicleDto = {
      id: String(r.id),
      externalRef: r.external_ref,
      unlockCode: r.unlock_code ?? '',
      type: r.type,
      status: r.status,
      battery: batteryFor(r.type, battery),
      rentable: isRentable(r.type, r.status, battery),
    };
    const key = String(r.station_id);
    out.set(key, [...(out.get(key) ?? []), dto]);
  }
  return out;
}

export async function getStation(id: string): Promise<RentalStationDetailDto> {
  const rows = await sequelize.query<StationRow>(`${selectStations()} AND rs.id = :id`, {
    replacements: { id },
    type: QueryTypes.SELECT,
  });
  if (rows.length === 0) throw new AppError('STATION_NOT_FOUND', `No rental station ${id}`);

  const [station] = await hydrate(rows);
  const vehicles = await vehiclesAt([id]);
  return { ...station!, vehicles: vehicles.get(id) ?? [] };
}

/** Stations near a point with their vehicles — what the recommender ranks. */
export async function stationDetailsNear(
  point: LngLat,
  radiusM: number,
): Promise<RentalStationDetailDto[]> {
  const stations = await stationsNear(point, radiusM, 12);
  const vehicles = await vehiclesAt(stations.map((s) => s.id));
  return stations.map((s) => ({ ...s, vehicles: vehicles.get(s.id) ?? [] }));
}

/**
 * The nearest active station to a point, with the facts a return needs.
 *
 * Takes a transaction so the return path can read capacity under the same
 * lock it writes with.
 */
export async function nearestStation(
  point: LngLat,
  t?: Transaction,
): Promise<(RentalStationDto & { returnRadiusM: number }) | null> {
  const rows = await sequelize.query<StationRow>(
    `${selectStations(point)} AND rs.status = 'active' ORDER BY distance_m LIMIT 1`,
    { type: QueryTypes.SELECT, transaction: t },
  );
  if (rows.length === 0) return null;
  const [dto] = await hydrate(rows, t);
  return { ...dto!, returnRadiusM: Number(rows[0]!.return_radius_m) };
}

export interface CreateStationInput {
  code: string;
  name: string;
  location: LngLat;
  capacity: number;
  returnRadiusM: number;
}

export async function createStation(input: CreateStationInput): Promise<RentalStationDetailDto> {
  const [existing] = await sequelize.query<{ id: string }>(
    'SELECT id FROM rental_stations WHERE code = :code LIMIT 1',
    { replacements: { code: input.code }, type: QueryTypes.SELECT },
  );
  if (existing) {
    throw AppError.conflict(
      'VALIDATION_FAILED',
      `A station with code ${input.code} already exists`,
    );
  }

  const point = pointLiteral(input.location).val;
  const [id] = await sequelize.query(
    `INSERT INTO rental_stations (code, name, zone_id, location, capacity, return_radius_m)
     SELECT :code, :name,
            (SELECT id FROM zones WHERE ST_Contains(boundary, ${point}) LIMIT 1),
            ${point}, :capacity, :radius`,
    {
      replacements: {
        code: input.code,
        name: input.name,
        capacity: input.capacity,
        radius: input.returnRadiusM,
      },
    },
  );
  return getStation(String(id));
}
