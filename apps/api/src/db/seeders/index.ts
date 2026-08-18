import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize';
import { ROLES, VEHICLE_TYPES } from '@mm/shared-types';
import type { LngLat, Role, VehicleStatus, VehicleType } from '@mm/shared-types';
import { sequelize as defaultSequelize } from '../index.ts';
import { ensureModels } from '../models/index.ts';
import { lineStringLiteral, pointLiteral, polygonLiteral } from '../spatial.ts';
import { pointInZone, ZONES } from './belagavi-geo.ts';
import { loadOsmSegments } from './osm.ts';
import { assertConnected } from './graph.ts';

import { seedChargingStations } from './charging.ts';
import { seedScenarios } from './scenarios.ts';

export interface SeedSummary {
  zones: number;
  segments: number;
  operators: number;
  vehicles: number;
  users: number;
  trips: number;
  telemetry: number;
  scenarios: number;
  chargingStations: number;
}

export interface SeedOptions {
  sequelize?: Sequelize;
  /** Suppress the credentials block — tests do not want it on stdout. */
  quiet?: boolean;
}

const BCRYPT_COST = 12;

const OPERATORS = [
  { code: 'BGM-MOBI', name: 'Belagavi Mobility Co-op', email: 'ops@bgm-mobi.example' },
  { code: 'SAHYADRI', name: 'Sahyadri Shared Wheels', email: 'ops@sahyadri.example' },
];

const DEMO_USERS: Array<{ role: Role; email: string; name: string }> = [
  { role: 'admin', email: 'admin@belagavi.local', name: 'Asha Deshpande' },
  { role: 'planner', email: 'planner@belagavi.local', name: 'Rohan Kulkarni' },
  { role: 'operator', email: 'operator@belagavi.local', name: 'Meera Patil' },
  { role: 'commuter', email: 'commuter@belagavi.local', name: 'Vikram Naik' },
  { role: 'analyst', email: 'analyst@belagavi.local', name: 'Priya Shetty' },
];

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Full platform administration',
  planner: 'City planning, scenarios and analysis',
  operator: 'Fleet operations for one operator',
  commuter: 'Rides vehicles and plans trips',
  analyst: 'Read-only analytics and model registry',
  device: 'Machine identity for IoT ingest (API key only)',
};

const VEHICLE_COUNT = 60;
const TRIP_COUNT = 12;
const TELEMETRY_PER_VEHICLE = 25;

/** Status mix across the fleet — indexed, not random. */
const STATUS_MIX: VehicleStatus[] = [
  'available', 'available', 'available', 'available', 'available',
  'in_use', 'in_use', 'reserved', 'returning', 'charging', 'maintenance',
];

async function scalar(s: Sequelize, sql: string): Promise<number> {
  const [row] = await s.query<{ n: string }>(sql, { type: QueryTypes.SELECT });
  return Number(row?.n ?? 0);
}

/** Nearest zone centroid to a segment's midpoint. */
function zoneCodeFor(geometry: LngLat[]): string {
  const mid = geometry[Math.floor(geometry.length / 2)] ?? geometry[0]!;
  let best = ZONES[0]!;
  let bestD = Number.POSITIVE_INFINITY;
  for (const z of ZONES) {
    const d = (z.centroid[0] - mid[0]) ** 2 + (z.centroid[1] - mid[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best.code;
}

export async function runSeed(options: SeedOptions = {}): Promise<SeedSummary> {
  const s = options.sequelize ?? defaultSequelize;
  ensureModels(s);

  const generatedPasswords: Array<{ role: Role; email: string; password: string }> = [];

  await s.transaction(async (t) => {
    // ---- roles (natural key: name) ----------------------------------------
    for (const name of ROLES) {
      await s.query(
        `INSERT INTO roles (name, description) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE description = VALUES(description)`,
        { replacements: [name, ROLE_DESCRIPTIONS[name]], transaction: t },
      );
    }

    // ---- operators (natural key: code) ------------------------------------
    for (const op of OPERATORS) {
      await s.query(
        `INSERT INTO operators (code, name, contact_email, status) VALUES (?, ?, ?, 'active')
         ON DUPLICATE KEY UPDATE name = VALUES(name), contact_email = VALUES(contact_email)`,
        { replacements: [op.code, op.name, op.email], transaction: t },
      );
    }

    // ---- zones (natural key: code) ----------------------------------------
    for (const z of ZONES) {
      const boundary = polygonLiteral(z.boundary).val as string;
      const centroid = pointLiteral(z.centroid).val as string;
      await s.query(
        `INSERT INTO zones (code, name, boundary, centroid, population_ix)
         VALUES (?, ?, ${boundary}, ${centroid}, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name), boundary = VALUES(boundary),
           centroid = VALUES(centroid), population_ix = VALUES(population_ix)`,
        { replacements: [z.code, z.name, z.populationIx], transaction: t },
      );
    }

    const zoneRows = await s.query<{ id: string; code: string }>(
      'SELECT id, code FROM zones',
      { type: QueryTypes.SELECT, transaction: t },
    );
    const zoneIdByCode = new Map(zoneRows.map((r) => [r.code, r.id]));

    // ---- road segments ----------------------------------------------------
    const segments = loadOsmSegments();

    // Refuse to insert a graph A* could not traverse. This runs BEFORE any
    // insert, so a broken generator fails loudly rather than seeding silently.
    assertConnected(segments.map((sg) => [sg.fromNode, sg.toNode] as [string, string]));

    for (const sg of segments) {
      const geom = lineStringLiteral(sg.geometry).val as string;
      await s.query(
        `INSERT INTO road_segments
           (external_ref, name, zone_id, from_node, to_node, geometry, length_m,
            speed_free_kph, lanes, one_way, gradient_pct, road_class, has_bike_lane, lit)
         VALUES (?, ?, ?, ?, ?, ${geom}, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name), zone_id = VALUES(zone_id), geometry = VALUES(geometry),
           length_m = VALUES(length_m), speed_free_kph = VALUES(speed_free_kph),
           lanes = VALUES(lanes), one_way = VALUES(one_way),
           gradient_pct = VALUES(gradient_pct), road_class = VALUES(road_class),
           has_bike_lane = VALUES(has_bike_lane), lit = VALUES(lit)`,
        {
          replacements: [
            sg.externalRef, sg.name, zoneIdByCode.get(zoneCodeFor(sg.geometry)) ?? null,
            sg.fromNode, sg.toNode, sg.lengthM, sg.speedFreeKph, sg.lanes,
            sg.oneWay ? 1 : 0, sg.gradientPct, sg.roadClass,
            sg.hasBikeLane ? 1 : 0, sg.lit ? 1 : 0,
          ],
          transaction: t,
        },
      );
    }

    // ---- users (natural key: email) ---------------------------------------
    const operatorRows = await s.query<{ id: string; code: string }>(
      'SELECT id, code FROM operators',
      { type: QueryTypes.SELECT, transaction: t },
    );
    const operatorIdByCode = new Map(operatorRows.map((r) => [r.code, r.id]));
    const firstOperatorId = operatorIdByCode.get(OPERATORS[0]!.code)!;

    const roleRows = await s.query<{ id: string; name: Role }>('SELECT id, name FROM roles', {
      type: QueryTypes.SELECT,
      transaction: t,
    });
    const roleIdByName = new Map(roleRows.map((r) => [r.name, r.id]));

    for (const u of DEMO_USERS) {
      const existing = await s.query<{ id: string }>(
        'SELECT id FROM users WHERE email = ? LIMIT 1',
        { type: QueryTypes.SELECT, replacements: [u.email], transaction: t },
      );

      let userId: string;
      if (existing.length > 0) {
        userId = existing[0]!.id;
      } else {
        // base64url of 9 bytes => 12 chars, no padding, URL-safe.
        const password = crypto.randomBytes(9).toString('base64url');
        const hash = await bcrypt.hash(password, BCRYPT_COST);
        generatedPasswords.push({ role: u.role, email: u.email, password });

        await s.query(
          `INSERT INTO users (email, password_hash, full_name, status, operator_id)
           VALUES (?, ?, ?, 'active', ?)`,
          {
            replacements: [
              u.email, hash, u.name,
              u.role === 'operator' ? firstOperatorId : null,
            ],
            transaction: t,
          },
        );
        const [created] = await s.query<{ id: string }>(
          'SELECT id FROM users WHERE email = ? LIMIT 1',
          { type: QueryTypes.SELECT, replacements: [u.email], transaction: t },
        );
        userId = created!.id;
      }

      await s.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE role_id = VALUES(role_id)`,
        { replacements: [userId, roleIdByName.get(u.role)], transaction: t },
      );
      await s.query(
        `INSERT INTO user_preferences (user_id) VALUES (?)
         ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
        { replacements: [userId], transaction: t },
      );
    }

    // ---- vehicles (natural key: operator_id + external_ref) ---------------
    /**
     * Overnight drift, not an even spread.
     *
     * Round-robin across zones produced a perfectly balanced fleet, which is
     * the one distribution a real city never has: vehicles end the night
     * wherever yesterday's trips *ended* — the commercial core and the transport
     * hub — while residential edges run thin. That mismatch between where the
     * fleet is and where tomorrow's demand starts is precisely the problem M07
     * exists to solve, so seeding it away left the optimiser with nothing to do.
     *
     * Weights are relative shares of the fleet, deliberately NOT proportional to
     * each zone's population index (which is what drives demand).
     */
    const DRIFT: Record<string, number> = {
      CMP: 4.5, // Camp — nightlife and retail, everything ends up here
      TLK: 3.0, // Tilakwadi — dense, well served
      SHP: 1.0, // Shahapur — busiest by day, stripped by morning
      HND: 2.2,
      ANG: 0.8,
      SDN: 1.6,
      VDG: 0.6, // residential edges, chronically short
      UDY: 0.5,
    };

    const zoneCodes = ZONES.map((z) => z.code);
    const driftTotal = zoneCodes.reduce((n, c) => n + (DRIFT[c] ?? 1), 0);
    // Deterministic cumulative allocation: vehicle i lands in the zone whose
    // share of the fleet covers position i. Same seed, same city, every time.
    const zoneForVehicle: string[] = [];
    for (const code of zoneCodes) {
      const count = Math.round((VEHICLE_COUNT * (DRIFT[code] ?? 1)) / driftTotal);
      for (let k = 0; k < count; k++) zoneForVehicle.push(code);
    }
    // Rounding can leave the array a vehicle short or long of the fleet size.
    while (zoneForVehicle.length < VEHICLE_COUNT) zoneForVehicle.push(zoneCodes[0]!);
    zoneForVehicle.length = VEHICLE_COUNT;
    for (let i = 0; i < VEHICLE_COUNT; i++) {
      const opCode = OPERATORS[i % OPERATORS.length]!.code;
      const operatorId = operatorIdByCode.get(opCode)!;
      const type: VehicleType = VEHICLE_TYPES[i % VEHICLE_TYPES.length]!;
      const status = STATUS_MIX[i % STATUS_MIX.length]!;
      const zoneCode = zoneForVehicle[i]!;
      const zoneId = zoneIdByCode.get(zoneCode)!;
      const zone = ZONES.find((z) => z.code === zoneCode)!;
      const pos: LngLat = pointInZone(zone.centroid, i);
      const externalRef = `${opCode}-${String(i + 1).padStart(4, '0')}`;
      // 18..97 in a repeating, deterministic pattern.
      const battery = type === 'bike' ? null : 18 + ((i * 13) % 80);
      const position = pointLiteral(pos).val as string;

      await s.query(
        `INSERT INTO vehicles
           (operator_id, home_zone_id, external_ref, type, status, battery_pct,
            last_seen_at, last_position)
         VALUES (?, ?, ?, ?, ?, ?, NOW(3), ${position})
         ON DUPLICATE KEY UPDATE
           home_zone_id = VALUES(home_zone_id), type = VALUES(type),
           status = VALUES(status), battery_pct = VALUES(battery_pct),
           last_position = VALUES(last_position)`,
        {
          replacements: [operatorId, zoneId, externalRef, type, status, battery],
          transaction: t,
        },
      );
    }

    const vehicleRows = await s.query<{ id: string; operator_id: string; status: VehicleStatus }>(
      'SELECT id, operator_id, status FROM vehicles ORDER BY id',
      { type: QueryTypes.SELECT, transaction: t },
    );

    // ---- status history: one creation row per vehicle ---------------------
    // No natural key, so guard on "does this vehicle already have history".
    for (const v of vehicleRows) {
      await s.query(
        `INSERT INTO vehicle_status_history (vehicle_id, from_status, to_status, reason)
         SELECT ?, NULL, ?, 'seeded'
         FROM DUAL
         WHERE NOT EXISTS (SELECT 1 FROM vehicle_status_history WHERE vehicle_id = ?)`,
        { replacements: [v.id, v.status, v.id], transaction: t },
      );
    }

    // ---- trips against the commuter account -------------------------------
    const [commuter] = await s.query<{ id: string }>(
      'SELECT id FROM users WHERE email = ? LIMIT 1',
      { type: QueryTypes.SELECT, replacements: ['commuter@belagavi.local'], transaction: t },
    );
    const existingTrips = await scalar(
      s,
      `SELECT COUNT(*) AS n FROM trips WHERE user_id = ${Number(commuter!.id)}`,
    );

    if (existingTrips === 0) {
      for (let i = 0; i < TRIP_COUNT; i++) {
        const v = vehicleRows[i % vehicleRows.length]!;
        const startZone = ZONES[i % ZONES.length]!;
        const endZone = ZONES[(i + 3) % ZONES.length]!;
        const start = pointInZone(startZone.centroid, i);
        const end = pointInZone(endZone.centroid, i + 7);
        const durationS = 420 + ((i * 97) % 1500);
        const distanceM = 900 + ((i * 311) % 5200);
        const startedDaysAgo = i + 1;

        await s.query(
          `INSERT INTO trips
             (public_ref, user_id, vehicle_id, operator_id, start_zone_id, end_zone_id,
              started_at, ended_at, start_position, end_position, distance_m, duration_s, status)
           VALUES (?, ?, ?, ?, ?, ?,
                   DATE_SUB(NOW(3), INTERVAL ? DAY),
                   DATE_SUB(NOW(3), INTERVAL ? SECOND),
                   ${pointLiteral(start).val as string},
                   ${pointLiteral(end).val as string},
                   ?, ?, 'completed')`,
          {
            replacements: [
              crypto.randomUUID(), commuter!.id, v.id, v.operator_id,
              zoneIdByCode.get(startZone.code), zoneIdByCode.get(endZone.code),
              startedDaysAgo, startedDaysAgo * 86_400 - durationS,
              distanceM, durationS,
            ],
            transaction: t,
          },
        );
      }
    }

    // ---- telemetry for the first 20 vehicles ------------------------------
    const telemetryVehicles = vehicleRows.slice(0, 20);
    const existingTelemetry = await scalar(s, 'SELECT COUNT(*) AS n FROM vehicle_telemetry');

    if (existingTelemetry === 0) {
      for (const [vi, v] of telemetryVehicles.entries()) {
        const zone = ZONES[vi % ZONES.length]!;
        const rows: string[] = [];
        const reps: unknown[] = [];
        for (let k = 0; k < TELEMETRY_PER_VEHICLE; k++) {
          const p = pointInZone(zone.centroid, vi * 31 + k);
          rows.push(
            '(?, DATE_SUB(NOW(3), INTERVAL ? MINUTE), ?, ?, ?, ?, ?, ?, ?)',
          );
          reps.push(
            v.id,
            k * 3,
            p[1], // lat
            p[0], // lng
            Number((6 + ((vi * 7 + k * 3) % 22)).toFixed(2)), // speed_kph
            20 + ((vi * 5 + k) % 78), // battery_pct
            1000 * (vi + 1) + k * 120, // odometer_m
            k % 5 === 0 ? 'unlocked' : 'locked',
            'synthetic',
          );
        }
        await s.query(
          `INSERT INTO vehicle_telemetry
             (vehicle_id, recorded_at, lat, lng, speed_kph, battery_pct, odometer_m,
              lock_state, source)
           VALUES ${rows.join(',')}`,
          { replacements: reps, transaction: t },
        );
      }
    }

    // M06 demo scenarios. Last, because they reference the seeded planner and
    // the seeded zones.
    await seedScenarios(s, t);
    await seedChargingStations(s, t);
  });

  const summary: SeedSummary = {
    zones: await scalar(s, 'SELECT COUNT(*) AS n FROM zones'),
    segments: await scalar(s, 'SELECT COUNT(*) AS n FROM road_segments'),
    operators: await scalar(s, 'SELECT COUNT(*) AS n FROM operators'),
    vehicles: await scalar(s, 'SELECT COUNT(*) AS n FROM vehicles'),
    users: await scalar(s, 'SELECT COUNT(*) AS n FROM users'),
    trips: await scalar(s, 'SELECT COUNT(*) AS n FROM trips'),
    telemetry: await scalar(s, 'SELECT COUNT(*) AS n FROM vehicle_telemetry'),
    scenarios: await scalar(s, 'SELECT COUNT(*) AS n FROM scenarios'),
    chargingStations: await scalar(s, 'SELECT COUNT(*) AS n FROM charging_stations'),
  };

  if (!options.quiet && generatedPasswords.length > 0) {
    // Printed once, never written to disk. Re-running the seed does not
    // regenerate these — existing accounts keep their original password.
    console.log('\n' + '='.repeat(66));
    console.log('  DEMO ACCOUNTS — copy these now, they are not stored anywhere');
    console.log('='.repeat(66));
    for (const p of generatedPasswords) {
      console.log(`  ${p.role.padEnd(9)} ${p.email.padEnd(28)} ${p.password}`);
    }
    console.log('='.repeat(66) + '\n');
  } else if (!options.quiet) {
    console.log('\nAll demo accounts already existed; no new passwords generated.\n');
  }

  return summary;
}
