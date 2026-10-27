import crypto from 'node:crypto';
import { QueryTypes, UniqueConstraintError } from 'sequelize';
import type { Transaction } from 'sequelize';
import type {
  EcoSummaryDto,
  FareBreakdownDto,
  FareEstimateDto,
  LngLat,
  PaymentDto,
  PricingPlanDto,
  ReceiptDto,
  RecommendationResponseDto,
  RentalDto,
  RentalStatus,
  UnlockPreviewDto,
  VehicleStatus,
  VehicleType,
} from '@mm/shared-types';
import { VEHICLE_TYPES } from '@mm/shared-types';
import { sequelize } from '../../db/index.ts';
import { parsePoint, pointLiteral, selectGeom } from '../../db/spatial.ts';
import { AppError } from '../../lib/errors.ts';
import { haversineM } from '../../lib/geo.ts';
import { bus } from '../../realtime/bus.ts';
import { emissionFactors } from '../analytics/rollups.ts';
import { planRoute } from '../routes/service.ts';
import { stationDetailsNear, nearestStation } from '../stations/service.ts';
import { assertTransition } from '../vehicles/state-machine.ts';
import { paymentGateway } from './payment-gateway.ts';
import { computeFare, fromMinor, toMinor } from './pricing.ts';
import { recommend } from './recommend.ts';
import {
  batteryFor,
  batteryUsedPct,
  isRentable,
  MIN_RENTABLE_BATTERY_PCT,
  RETURN_TO_CHARGE_BELOW_PCT,
  rideSeconds,
} from './specs.ts';

/**
 * Renting a vehicle: unlock by QR code, ride with GPS tracking, return to a
 * station, pay.
 *
 * A rental IS a trip row — the same table the analytics rollups and the
 * rider's history already read — with a fare, a station at each end and a GPS
 * trace attached. One record of the journey, not two that can disagree.
 */

// ---- tariffs ---------------------------------------------------------------

interface PlanRow {
  id: string;
  vehicle_type: VehicleType;
  name: string;
  currency: string;
  unlock_fee: string;
  per_minute: string;
  minimum_fare: string;
}

function toPlanDto(r: PlanRow): PricingPlanDto {
  return {
    id: String(r.id),
    vehicleType: r.vehicle_type,
    name: r.name,
    currency: r.currency,
    unlockFeeMinor: toMinor(r.unlock_fee),
    perMinuteMinor: toMinor(r.per_minute),
    minimumFareMinor: toMinor(r.minimum_fare),
  };
}

export async function listPlans(t?: Transaction): Promise<Map<VehicleType, PricingPlanDto>> {
  const rows = await sequelize.query<PlanRow>(
    `SELECT id, vehicle_type, name, currency, unlock_fee, per_minute, minimum_fare
       FROM pricing_plans WHERE active = 1 ORDER BY id`,
    { type: QueryTypes.SELECT, transaction: t },
  );
  // Latest active plan per type wins.
  return new Map(rows.map((r) => [r.vehicle_type, toPlanDto(r)]));
}

async function planFor(type: VehicleType, t?: Transaction): Promise<PricingPlanDto> {
  const plan = (await listPlans(t)).get(type);
  if (!plan) throw new AppError('VEHICLE_NOT_RENTABLE', `There is no active tariff for ${type}`);
  return plan;
}

/** What a ride of this length will cost, quoted before the rider unlocks. */
export async function estimateFare(
  type: VehicleType,
  distanceM: number,
  durationS?: number,
): Promise<FareEstimateDto> {
  const plan = await planFor(type);
  const seconds = durationS ?? rideSeconds(type, distanceM);
  return {
    vehicleType: type,
    plan,
    distanceM,
    durationS: seconds,
    fare: computeFare(plan, seconds),
  };
}

/**
 * What the rider sees after scanning, before they unlock: the vehicle, its
 * charge and range, the tariff — and, if it cannot be rented, why not.
 */
export async function previewUnlock(unlockCode: string): Promise<UnlockPreviewDto> {
  const code = unlockCode.trim().toUpperCase();
  const [v] = await sequelize.query<{
    id: string;
    external_ref: string;
    unlock_code: string;
    type: VehicleType;
    status: VehicleStatus;
    battery_pct: number | null;
    station_name: string | null;
  }>(
    `SELECT v.id, v.external_ref, v.unlock_code, v.type, v.status, v.battery_pct,
            rs.name AS station_name
       FROM vehicles v LEFT JOIN rental_stations rs ON rs.id = v.station_id
      WHERE v.unlock_code = :code AND v.deleted_at IS NULL`,
    { replacements: { code }, type: QueryTypes.SELECT },
  );
  if (!v) throw AppError.notFound('VEHICLE_NOT_FOUND', `No vehicle has the code ${code}`);

  const battery = v.battery_pct === null ? null : Number(v.battery_pct);
  const rentable = isRentable(v.type, v.status, battery);
  return {
    vehicle: {
      id: String(v.id),
      externalRef: v.external_ref,
      unlockCode: v.unlock_code,
      type: v.type,
      status: v.status,
      battery: batteryFor(v.type, battery),
      rentable,
    },
    stationName: v.station_name,
    plan: await planFor(v.type),
    notRentableReason: rentable
      ? null
      : v.status !== 'available'
        ? `This vehicle is ${v.status.replace('_', ' ')}.`
        : `Its battery is at ${battery}%, below the ${MIN_RENTABLE_BATTERY_PCT}% needed to rent.`,
  };
}

// ---- recommendation --------------------------------------------------------

/** How far a rider will walk to a station before it stops being "near". */
const WALK_RADIUS_M = 1500;

/** Streets are not straight lines. A typical urban detour over crow-flies. */
const DETOUR_FACTOR = 1.35;

export async function recommendVehicles(
  origin: LngLat,
  destination: LngLat,
): Promise<RecommendationResponseDto> {
  let tripDistanceM: number;
  let distanceSource: RecommendationResponseDto['distanceSource'] = 'route';
  try {
    const route = (await planRoute({ origin, destination, mode: 'ebike', profile: 'fastest' })) as {
      distanceM: number;
    };
    tripDistanceM = route.distanceM;
  } catch (e) {
    // The router being down must not stop a rider renting. A straight-line
    // estimate with a detour factor is a worse number, so the response says
    // which one it is rather than passing the guess off as a route.
    if (!(e instanceof AppError)) throw e;
    tripDistanceM = Math.round(haversineM(origin, destination) * DETOUR_FACTOR);
    distanceSource = 'estimate';
  }

  const [stations, plans] = await Promise.all([
    stationDetailsNear(origin, WALK_RADIUS_M),
    listPlans(),
  ]);
  const result = recommend({ tripDistanceM, stations, plans });
  return { tripDistanceM, distanceSource, ...result };
}

// ---- reading a rental ------------------------------------------------------

interface TripRow {
  id: string;
  public_ref: string;
  user_id: string;
  status: RentalStatus;
  vehicle_id: string;
  external_ref: string;
  unlock_code: string | null;
  vehicle_type: VehicleType;
  battery_pct: number | null;
  start_station_id: string | null;
  start_station_name: string | null;
  end_station_id: string | null;
  end_station_name: string | null;
  started_at: Date;
  ended_at: Date | null;
  start_wkt: string | null;
  end_wkt: string | null;
  distance_m: string | null;
  duration_s: number | null;
  start_battery_pct: number | null;
  fare_breakdown: FareBreakdownDto | string | null;
  energy_wh: string | null;
  co2_saved_g: string | null;
  plan_id: string | null;
  plan_type: VehicleType | null;
  plan_name: string | null;
  plan_currency: string | null;
  plan_unlock: string | null;
  plan_minute: string | null;
  plan_minimum: string | null;
  operator_name: string | null;
}

const TRIP_SELECT = `
  SELECT t.id, t.public_ref, t.user_id, t.status, t.vehicle_id,
         v.external_ref, v.unlock_code, v.type AS vehicle_type, v.battery_pct,
         t.start_station_id, ss.name AS start_station_name,
         t.end_station_id, es.name AS end_station_name,
         t.started_at, t.ended_at,
         ${selectGeom('t.start_position', 'start_wkt')},
         ${selectGeom('t.end_position', 'end_wkt')},
         t.distance_m, t.duration_s, t.start_battery_pct,
         t.fare_breakdown, t.energy_wh, t.co2_saved_g,
         p.id AS plan_id, p.vehicle_type AS plan_type, p.name AS plan_name,
         p.currency AS plan_currency, p.unlock_fee AS plan_unlock,
         p.per_minute AS plan_minute, p.minimum_fare AS plan_minimum,
         o.name AS operator_name
    FROM trips t
    JOIN vehicles v ON v.id = t.vehicle_id
    LEFT JOIN rental_stations ss ON ss.id = t.start_station_id
    LEFT JOIN rental_stations es ON es.id = t.end_station_id
    LEFT JOIN pricing_plans p ON p.id = t.pricing_plan_id
    LEFT JOIN operators o ON o.id = t.operator_id`;

function planOf(r: TripRow): PricingPlanDto | null {
  if (r.plan_id === null) return null;
  return toPlanDto({
    id: r.plan_id,
    vehicle_type: r.plan_type!,
    name: r.plan_name!,
    currency: r.plan_currency!,
    unlock_fee: r.plan_unlock!,
    per_minute: r.plan_minute!,
    minimum_fare: r.plan_minimum!,
  });
}

function elapsedSeconds(r: TripRow): number {
  if (r.status !== 'active') return Number(r.duration_s ?? 0);
  return Math.max(0, Math.round((Date.now() - new Date(r.started_at).getTime()) / 1000));
}

async function pathFor(tripId: string): Promise<LngLat[]> {
  const rows = await sequelize.query<{ wkt: string | null }>(
    `SELECT ${selectGeom('position', 'wkt')}
       FROM trip_points WHERE trip_id = :id ORDER BY recorded_at, id`,
    { replacements: { id: tripId }, type: QueryTypes.SELECT },
  );
  return rows
    .map((r) => parsePoint(r.wkt)?.coordinates ?? null)
    .filter((p): p is LngLat => p !== null);
}

interface PaymentRow {
  id: string;
  amount: string;
  currency: string;
  provider: string;
  provider_ref: string | null;
  status: PaymentDto['status'];
  created_at: Date;
}

async function paymentFor(tripId: string): Promise<PaymentDto | null> {
  const [p] = await sequelize.query<PaymentRow>(
    `SELECT id, amount, currency, provider, provider_ref, status, created_at
       FROM payments WHERE trip_id = :id LIMIT 1`,
    { replacements: { id: tripId }, type: QueryTypes.SELECT },
  );
  if (!p) return null;
  return {
    id: String(p.id),
    amountMinor: toMinor(p.amount),
    currency: p.currency,
    provider: p.provider,
    providerRef: p.provider_ref,
    status: p.status,
    createdAt: new Date(p.created_at).toISOString(),
  };
}

async function toRentalDto(r: TripRow, withPath: boolean): Promise<RentalDto> {
  const plan = planOf(r);
  const durationS = elapsedSeconds(r);
  const storedFare =
    typeof r.fare_breakdown === 'string'
      ? (JSON.parse(r.fare_breakdown) as FareBreakdownDto)
      : r.fare_breakdown;
  // While active the fare runs with the clock; once completed it is what was charged.
  const fare = r.status === 'active' && plan ? computeFare(plan, durationS) : storedFare;

  return {
    id: String(r.id),
    publicRef: r.public_ref,
    status: r.status,
    vehicle: {
      id: String(r.vehicle_id),
      externalRef: r.external_ref,
      unlockCode: r.unlock_code ?? '',
      type: r.vehicle_type,
      battery: batteryFor(r.vehicle_type, r.battery_pct === null ? null : Number(r.battery_pct)),
    },
    startStation: r.start_station_id
      ? { id: String(r.start_station_id), name: r.start_station_name! }
      : null,
    endStation: r.end_station_id
      ? { id: String(r.end_station_id), name: r.end_station_name! }
      : null,
    startedAt: new Date(r.started_at).toISOString(),
    endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
    startPosition: parsePoint(r.start_wkt)?.coordinates ?? null,
    endPosition: parsePoint(r.end_wkt)?.coordinates ?? null,
    distanceM: Math.round(Number(r.distance_m ?? 0)),
    durationS,
    plan,
    fare: fare ?? null,
    energyWh: r.energy_wh === null ? null : Number(r.energy_wh),
    co2SavedG: r.co2_saved_g === null ? null : Number(r.co2_saved_g),
    path: withPath ? await pathFor(String(r.id)) : [],
    payment: await paymentFor(String(r.id)),
  };
}

/** A rider's own rental. Someone else's is reported as not found, not forbidden. */
async function ownTripRow(userId: string, tripId: string, t?: Transaction): Promise<TripRow> {
  const [row] = await sequelize.query<TripRow>(
    `${TRIP_SELECT} WHERE t.id = :id AND t.user_id = :user`,
    {
      replacements: { id: tripId, user: userId },
      type: QueryTypes.SELECT,
      transaction: t,
    },
  );
  if (!row) throw AppError.notFound('RENTAL_NOT_FOUND', `No rental ${tripId}`);
  return row;
}

/**
 * Lock the trip row before reading it for an update. Two GPS fixes arriving
 * together would otherwise both read the same distance and one increment
 * would be lost.
 */
async function lockOwnTrip(userId: string, tripId: string, t: Transaction): Promise<TripRow> {
  await sequelize.query('SELECT id FROM trips WHERE id = :id AND user_id = :user FOR UPDATE', {
    replacements: { id: tripId, user: userId },
    transaction: t,
  });
  return ownTripRow(userId, tripId, t);
}

export async function getRental(userId: string, tripId: string): Promise<RentalDto> {
  return toRentalDto(await ownTripRow(userId, tripId), true);
}

export async function getActiveRental(userId: string): Promise<RentalDto | null> {
  const [row] = await sequelize.query<TripRow>(
    `${TRIP_SELECT} WHERE t.user_id = :user AND t.status = 'active' LIMIT 1`,
    { replacements: { user: userId }, type: QueryTypes.SELECT },
  );
  return row ? toRentalDto(row, true) : null;
}

export async function listRentals(userId: string, limit = 50): Promise<RentalDto[]> {
  const rows = await sequelize.query<TripRow>(
    `${TRIP_SELECT} WHERE t.user_id = :user ORDER BY t.started_at DESC, t.id DESC LIMIT :limit`,
    { replacements: { user: userId, limit }, type: QueryTypes.SELECT },
  );
  return Promise.all(rows.map((r) => toRentalDto(r, false)));
}

// ---- status changes ---------------------------------------------------------

async function recordStatus(
  vehicleId: string,
  from: VehicleStatus,
  to: VehicleStatus,
  reason: string,
  userId: string,
  t: Transaction,
): Promise<void> {
  assertTransition(from, to);
  await sequelize.query('UPDATE vehicles SET status = :to WHERE id = :id', {
    replacements: { to, id: vehicleId },
    transaction: t,
  });
  await sequelize.query(
    `INSERT INTO vehicle_status_history (vehicle_id, from_status, to_status, reason, changed_by)
     VALUES (:id, :from, :to, :reason, :user)`,
    { replacements: { id: vehicleId, from, to, reason, user: userId }, transaction: t },
  );
}

function announce(vehicleId: string, changes: Array<[VehicleStatus, VehicleStatus]>): void {
  const at = new Date().toISOString();
  for (const [from, to] of changes) bus.emit('vehicle:status', { vehicleId, from, to, at });
}

// ---- start -----------------------------------------------------------------

interface LockedVehicle {
  id: string;
  operator_id: string;
  home_zone_id: string | null;
  station_id: string | null;
  type: VehicleType;
  status: VehicleStatus;
  battery_pct: number | null;
  position_wkt: string | null;
}

/**
 * Unlock a vehicle by the code on its QR sticker and start the ride.
 *
 * The start time and place are the server's, not the client's: the clock is
 * what the fare is charged on, and the place is where the vehicle actually is.
 */
export async function startRental(userId: string, unlockCode: string): Promise<RentalDto> {
  const code = unlockCode.trim().toUpperCase();
  let vehicleId = '';

  let tripId: string;
  try {
    tripId = await sequelize.transaction(async (t) => {
      const [v] = await sequelize.query<LockedVehicle>(
        `SELECT id, operator_id, home_zone_id, station_id, type, status, battery_pct,
                ${selectGeom('last_position', 'position_wkt')}
           FROM vehicles
          WHERE unlock_code = :code AND deleted_at IS NULL
          FOR UPDATE`,
        { replacements: { code }, type: QueryTypes.SELECT, transaction: t },
      );
      if (!v) throw AppError.notFound('VEHICLE_NOT_FOUND', `No vehicle has the code ${code}`);
      vehicleId = String(v.id);

      const battery = v.battery_pct === null ? null : Number(v.battery_pct);
      if (!isRentable(v.type, v.status, battery)) {
        const why =
          v.status !== 'available'
            ? `it is ${v.status.replace('_', ' ')}`
            : `its battery is at ${battery}%, too low to ride`;
        throw AppError.conflict('VEHICLE_NOT_RENTABLE', `This vehicle cannot be rented: ${why}.`);
      }

      const plan = await planFor(v.type, t);
      const position = parsePoint(v.position_wkt)?.coordinates ?? null;
      const positionSql = position ? (pointLiteral(position).val as string) : 'NULL';

      const [id] = await sequelize.query(
        `INSERT INTO trips
           (public_ref, user_id, vehicle_id, operator_id, start_zone_id, start_station_id,
            pricing_plan_id, started_at, start_position, distance_m, start_battery_pct, status)
         VALUES (:ref, :user, :vehicle, :operator,
                 ${
                   position
                     ? `COALESCE((SELECT id FROM zones WHERE ST_Contains(boundary, ${positionSql}) LIMIT 1), :zone)`
                     : ':zone'
                 },
                 :station, :plan, NOW(3), ${positionSql}, 0, :battery, 'active')`,
        {
          replacements: {
            ref: crypto.randomUUID(),
            user: userId,
            vehicle: v.id,
            operator: v.operator_id,
            zone: v.home_zone_id,
            station: v.station_id,
            plan: plan.id,
            battery,
          },
          transaction: t,
        },
      );

      if (position) {
        await sequelize.query(
          `INSERT INTO trip_points (trip_id, recorded_at, position, source)
           VALUES (:trip, NOW(3), ${positionSql}, 'gps')`,
          { replacements: { trip: id }, transaction: t },
        );
      }

      // Leaving the dock frees it for someone else's return.
      await sequelize.query('UPDATE vehicles SET station_id = NULL WHERE id = :id', {
        replacements: { id: v.id },
        transaction: t,
      });
      await recordStatus(String(v.id), 'available', 'in_use', 'rental started', userId, t);

      return String(id);
    });
  } catch (e) {
    // The generated-column UNIQUE keys from migration 29 fire here when this
    // rider already has a ride going — however two requests interleaved.
    if (e instanceof UniqueConstraintError) {
      throw AppError.conflict(
        'RENTAL_ALREADY_ACTIVE',
        'You already have a ride in progress. End it before starting another.',
      );
    }
    throw e;
  }

  announce(vehicleId, [['available', 'in_use']]);
  return getRental(userId, tripId);
}

// ---- tracking --------------------------------------------------------------

/**
 * Fastest believable speed between two GPS fixes. Phones occasionally report a
 * fix hundreds of metres off; adding that jump to the trip would bill and
 * drain the battery for distance never ridden. The fix is still stored — it is
 * evidence — but a step implying more than this does not count as distance.
 *
 * Judged by speed rather than by a fixed distance, so a phone that only
 * reports every minute or two is not penalised for honest gaps.
 */
const MAX_PLAUSIBLE_MPS = 60 / 3.6;

/** Below this a step is GPS wobble whatever the timing — count it, it is tiny. */
const JITTER_M = 30;

export interface TrackInput {
  position: LngLat;
  speedKph?: number | null;
  accuracyM?: number | null;
  source: 'gps' | 'simulated';
}

export async function trackRental(
  userId: string,
  tripId: string,
  input: TrackInput,
): Promise<RentalDto> {
  await sequelize.transaction(async (t) => {
    const row = await lockOwnTrip(userId, tripId, t);
    if (row.status !== 'active') {
      throw AppError.conflict('RENTAL_NOT_FOUND', 'This ride has already ended.');
    }

    const [last] = await sequelize.query<{ wkt: string | null; age_s: string }>(
      `SELECT ${selectGeom('position', 'wkt')},
              TIMESTAMPDIFF(MICROSECOND, recorded_at, NOW(3)) / 1e6 AS age_s
         FROM trip_points
        WHERE trip_id = :id ORDER BY recorded_at DESC, id DESC LIMIT 1`,
      { replacements: { id: tripId }, type: QueryTypes.SELECT, transaction: t },
    );
    const previous = parsePoint(last?.wkt)?.coordinates ?? null;
    const step = previous ? haversineM(previous, input.position) : 0;
    const ageS = Math.max(0.001, Number(last?.age_s ?? 0));
    // A simulated ride is replayed faster than real time on purpose, so only
    // real GPS is held to the speed limit.
    const plausible =
      input.source === 'simulated' || step <= JITTER_M || step / ageS <= MAX_PLAUSIBLE_MPS;
    const counted = plausible ? step : 0;

    const point = pointLiteral(input.position).val as string;
    await sequelize.query(
      `INSERT INTO trip_points (trip_id, recorded_at, position, speed_kph, accuracy_m, source)
       VALUES (:trip, NOW(3), ${point}, :speed, :accuracy, :source)`,
      {
        replacements: {
          trip: tripId,
          speed: input.speedKph ?? null,
          accuracy: input.accuracyM ?? null,
          source: input.source,
        },
        transaction: t,
      },
    );

    const distanceM = Number(row.distance_m ?? 0) + counted;
    await sequelize.query('UPDATE trips SET distance_m = :d WHERE id = :id', {
      replacements: { d: distanceM.toFixed(2), id: tripId },
      transaction: t,
    });

    // Battery is recomputed from the start charge and the whole distance, not
    // decremented per fix: a TINYINT cannot hold the 0.1% a 30 m step costs,
    // and per-fix rounding would leave the battery never draining at all.
    const start = row.start_battery_pct;
    const battery =
      start === null
        ? null
        : Math.max(0, Math.round(Number(start) - batteryUsedPct(row.vehicle_type, distanceM)));

    await sequelize.query(
      `UPDATE vehicles
          SET last_position = ${point}, last_seen_at = NOW(3), battery_pct = :battery
        WHERE id = :id`,
      { replacements: { battery, id: row.vehicle_id }, transaction: t },
    );
  });

  return getRental(userId, tripId);
}

// ---- end -------------------------------------------------------------------

/**
 * End the ride at a station: the "verified return".
 *
 * Verified means the server checks, from the vehicle's last reported position,
 * that it is within the station's return radius and that the station has a
 * free dock. Only then does the vehicle become rentable again — a vehicle
 * abandoned in a side street must not appear as available at a station it
 * never reached.
 *
 * Payment happens after the trip is committed. If the gateway fails, the ride
 * is still over and the vehicle still returned; the payment stays `failed`
 * and can be retried. A rider is never held on a vehicle by a payment outage.
 */
export async function endRental(
  userId: string,
  tripId: string,
  position?: LngLat,
): Promise<RentalDto> {
  const changes: Array<[VehicleStatus, VehicleStatus]> = [];
  let vehicleId = '';

  const charge = await sequelize.transaction(async (t) => {
    const row = await lockOwnTrip(userId, tripId, t);
    if (row.status !== 'active') {
      throw AppError.conflict('RENTAL_NOT_FOUND', 'This ride has already ended.');
    }
    vehicleId = String(row.vehicle_id);

    const [v] = await sequelize.query<LockedVehicle>(
      `SELECT id, operator_id, home_zone_id, station_id, type, status, battery_pct,
              ${selectGeom('last_position', 'position_wkt')}
         FROM vehicles WHERE id = :id FOR UPDATE`,
      { replacements: { id: row.vehicle_id }, type: QueryTypes.SELECT, transaction: t },
    );

    const at = position ?? parsePoint(v!.position_wkt)?.coordinates ?? null;
    if (!at) {
      throw new AppError('RETURN_NOT_AT_STATION', 'We have no position for this vehicle yet.');
    }

    const station = await nearestStation(at, t);
    const away = station ? haversineM(at, station.location) : Infinity;
    if (!station || away > station.returnRadiusM) {
      throw new AppError(
        'RETURN_NOT_AT_STATION',
        station
          ? `Park at a station to end the ride. ${station.name} is ${Math.round(away)} m away.`
          : 'Park at a station to end the ride. There is no open station nearby.',
        station
          ? [
              { path: 'stationId', message: station.id },
              { path: 'stationName', message: station.name },
              { path: 'distanceM', message: String(Math.round(away)) },
              { path: 'location', message: JSON.stringify(station.location) },
            ]
          : undefined,
      );
    }
    if (station.freeDocks <= 0) {
      throw AppError.conflict(
        'STATION_FULL',
        `${station.name} is full. Try another nearby station.`,
      );
    }

    const plan = planOf(row) ?? (await planFor(row.vehicle_type, t));
    const durationS = elapsedSeconds(row);
    // GPS distance when there is a trace; never less than the straight line
    // between where the ride started and where it ended.
    const start = parsePoint(row.start_wkt)?.coordinates ?? null;
    const crow = start ? haversineM(start, at) : 0;
    const distanceM = Math.max(Number(row.distance_m ?? 0), crow);
    const fare = computeFare(plan, durationS);

    const factors = await emissionFactors();
    const km = distanceM / 1000;
    const car = factors.get('car')?.gCo2ePerKm ?? 120;
    const mode = factors.get(row.vehicle_type);
    const energyWh = (mode?.whPerKm ?? 0) * km;
    const co2SavedG = Math.max(0, (car - (mode?.gCo2ePerKm ?? 0)) * km);

    const startBattery = row.start_battery_pct === null ? null : Number(row.start_battery_pct);
    const endBattery =
      startBattery === null
        ? null
        : Math.max(0, Math.round(startBattery - batteryUsedPct(row.vehicle_type, distanceM)));

    const point = pointLiteral(at).val as string;
    await sequelize.query(
      `UPDATE trips
          SET status = 'completed', ended_at = NOW(3), end_position = ${point},
              end_zone_id = (SELECT id FROM zones WHERE ST_Contains(boundary, ${point}) LIMIT 1),
              end_station_id = :station, duration_s = :duration, distance_m = :distance,
              end_battery_pct = :battery, fare_total = :fare, fare_breakdown = :breakdown,
              energy_wh = :energy, co2_saved_g = :co2
        WHERE id = :id`,
      {
        replacements: {
          station: station.id,
          duration: durationS,
          distance: distanceM.toFixed(2),
          battery: endBattery,
          fare: fromMinor(fare.totalMinor),
          breakdown: JSON.stringify(fare),
          energy: energyWh.toFixed(2),
          co2: co2SavedG.toFixed(2),
          id: tripId,
        },
        transaction: t,
      },
    );
    await sequelize.query(
      `INSERT INTO trip_points (trip_id, recorded_at, position, source)
       VALUES (:trip, NOW(3), ${point}, 'gps')`,
      { replacements: { trip: tripId }, transaction: t },
    );

    // Docked at the station, where it physically is.
    await sequelize.query(
      `UPDATE vehicles
          SET station_id = :station, last_position = ${point}, last_seen_at = NOW(3),
              battery_pct = :battery
        WHERE id = :id`,
      {
        replacements: { station: station.id, battery: endBattery, id: row.vehicle_id },
        transaction: t,
      },
    );

    // in_use → returning → available, or → charging if the ride left it flat.
    // Both hops go through the state machine and both write history, so the
    // fleet screen shows the return happening rather than a status jump.
    const next: VehicleStatus =
      endBattery !== null && endBattery <= RETURN_TO_CHARGE_BELOW_PCT ? 'charging' : 'available';
    await recordStatus(
      String(row.vehicle_id),
      'in_use',
      'returning',
      `returned to ${station.code}`,
      userId,
      t,
    );
    await recordStatus(
      String(row.vehicle_id),
      'returning',
      next,
      'return verified at station',
      userId,
      t,
    );
    changes.push(['in_use', 'returning'], ['returning', next]);

    const gateway = paymentGateway();
    const [paymentId] = await sequelize.query(
      `INSERT INTO payments (user_id, trip_id, amount, currency, provider, status)
       VALUES (:user, :trip, :amount, :currency, :provider, 'pending')`,
      {
        replacements: {
          user: userId,
          trip: tripId,
          amount: fromMinor(fare.totalMinor),
          currency: fare.currency,
          provider: gateway.name,
        },
        transaction: t,
      },
    );

    return {
      paymentId: String(paymentId),
      amountMinor: fare.totalMinor,
      currency: fare.currency,
      ref: row.public_ref,
    };
  });

  announce(vehicleId, changes);
  await settlePayment(charge.paymentId, charge.amountMinor, charge.currency, charge.ref);
  return getRental(userId, tripId);
}

async function settlePayment(
  paymentId: string,
  amountMinor: number,
  currency: string,
  reference: string,
): Promise<void> {
  let result;
  try {
    result = await paymentGateway().charge({ amountMinor, currency, reference });
  } catch {
    result = {
      status: 'failed' as const,
      providerRef: null,
      failureReason: 'Payment provider unreachable',
    };
  }
  await sequelize.query(
    `UPDATE payments SET status = :status, provider_ref = :ref, failure_reason = :reason
      WHERE id = :id AND status <> 'succeeded'`,
    {
      replacements: {
        status: result.status,
        ref: result.providerRef,
        reason: result.failureReason,
        id: paymentId,
      },
    },
  );
}

/** Retry a payment that failed. A succeeded payment is never charged twice. */
export async function retryPayment(userId: string, tripId: string): Promise<RentalDto> {
  const row = await ownTripRow(userId, tripId);
  const [p] = await sequelize.query<{
    id: string;
    amount: string;
    currency: string;
    status: string;
  }>('SELECT id, amount, currency, status FROM payments WHERE trip_id = :id LIMIT 1', {
    replacements: { id: tripId },
    type: QueryTypes.SELECT,
  });
  if (!p) throw AppError.notFound('RENTAL_NOT_FOUND', 'This ride has no payment to retry.');
  if (p.status !== 'succeeded') {
    await settlePayment(String(p.id), toMinor(p.amount), p.currency, row.public_ref);
  }
  const rental = await getRental(userId, tripId);
  if (rental.payment?.status === 'failed') {
    throw new AppError('PAYMENT_FAILED', 'The payment was declined again. Please try later.');
  }
  return rental;
}

// ---- receipts and eco summary ----------------------------------------------

export async function getReceipt(userId: string, tripId: string): Promise<ReceiptDto> {
  const row = await ownTripRow(userId, tripId);
  if (row.status !== 'completed') {
    throw AppError.conflict('RENTAL_NOT_FOUND', 'A receipt is issued once the ride has ended.');
  }
  const [user] = await sequelize.query<{ full_name: string; email: string }>(
    'SELECT full_name, email FROM users WHERE id = :id',
    { replacements: { id: userId }, type: QueryTypes.SELECT },
  );
  const ended = new Date(row.ended_at!);
  const ymd = ended.toISOString().slice(0, 10).replaceAll('-', '');

  return {
    receiptNo: `RCPT-${ymd}-${String(row.id).padStart(6, '0')}`,
    issuedAt: ended.toISOString(),
    rider: { name: user?.full_name ?? '', email: user?.email ?? '' },
    operatorName: row.operator_name ?? '',
    rental: await toRentalDto(row, true),
  };
}

/**
 * The rider's own totals.
 *
 * Aggregated at request time, which CLAUDE.md otherwise reserves for the
 * nightly rollup. The exception is bounded: one rider's trips, read through
 * the (user_id, started_at) index — dozens of rows, not the city's history.
 */
export async function ecoSummary(userId: string): Promise<EcoSummaryDto> {
  const rows = await sequelize.query<{
    type: VehicleType;
    trips: string;
    distance_m: string | null;
    duration_s: string | null;
    spent: string | null;
    energy_wh: string | null;
    co2_g: string | null;
    legacy_m: string | null;
  }>(
    `SELECT v.type, COUNT(*) AS trips, SUM(t.distance_m) AS distance_m,
            SUM(t.duration_s) AS duration_s, SUM(t.fare_total) AS spent,
            SUM(t.energy_wh) AS energy_wh, SUM(t.co2_saved_g) AS co2_g,
            SUM(CASE WHEN t.co2_saved_g IS NULL THEN t.distance_m ELSE 0 END) AS legacy_m
       FROM trips t JOIN vehicles v ON v.id = t.vehicle_id
      WHERE t.user_id = :user AND t.status = 'completed'
      GROUP BY v.type`,
    { replacements: { user: userId }, type: QueryTypes.SELECT },
  );

  // Trips from before renting existed carry no stored CO2 or energy. Theirs is
  // derived from the same factors, so the summary covers the whole history.
  const factors = await emissionFactors();
  const car = factors.get('car')?.gCo2ePerKm ?? 120;

  const byType = rows.map((r) => {
    const f = factors.get(r.type);
    const legacyKm = Number(r.legacy_m ?? 0) / 1000;
    const co2G = Number(r.co2_g ?? 0) + Math.max(0, (car - (f?.gCo2ePerKm ?? 0)) * legacyKm);
    const energyWh = Number(r.energy_wh ?? 0) + (f?.whPerKm ?? 0) * legacyKm;
    return {
      type: r.type,
      trips: Number(r.trips),
      distanceKm: Number((Number(r.distance_m ?? 0) / 1000).toFixed(2)),
      co2SavedKg: Number((co2G / 1000).toFixed(3)),
      energyKwh: energyWh / 1000,
      minutes: Number(r.duration_s ?? 0) / 60,
      spentMinor: toMinor(r.spent ?? 0),
    };
  });

  const sum = (f: (x: (typeof byType)[number]) => number) => byType.reduce((n, x) => n + f(x), 0);

  return {
    trips: sum((x) => x.trips),
    distanceKm: Number(sum((x) => x.distanceKm).toFixed(2)),
    rideMinutes: Math.round(sum((x) => x.minutes)),
    spentMinor: sum((x) => x.spentMinor),
    currency: 'INR',
    energyKwh: Number(sum((x) => x.energyKwh).toFixed(3)),
    co2SavedKg: Number(sum((x) => x.co2SavedKg).toFixed(3)),
    byType: VEHICLE_TYPES.flatMap((type) => {
      const x = byType.find((b) => b.type === type);
      return x
        ? [{ type, trips: x.trips, distanceKm: x.distanceKm, co2SavedKg: x.co2SavedKg }]
        : [];
    }),
    counterfactual: 'Each ride is assumed to replace a car trip of the same distance.',
  };
}
