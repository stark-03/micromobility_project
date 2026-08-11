import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { QueryTypes } from 'sequelize';
import { ROLES } from '@mm/shared-types';
import type { Role, VehicleStatus, VehicleType } from '@mm/shared-types';
import { pointLiteral, polygonLiteral } from '../../src/db/spatial.ts';
import { ZONES } from '../../src/db/seeders/belagavi-geo.ts';
import { Operator, Role as RoleModel, User, UserRole, Vehicle, Zone } from '../../src/db/models/index.ts';
import { testDb } from './db.ts';

/** Known password for every fixture user. Cost 4 keeps the suite fast. */
export const TEST_PASSWORD = 'Test1234!pass';
const TEST_BCRYPT_COST = 4;

export interface ReferenceIds {
  roleIdByName: Map<Role, string>;
  operatorIds: string[];
  zoneIdByCode: Map<string, string>;
}

/**
 * Reference data only — roles, 2 operators, 8 zones. Deliberately much smaller
 * than the full Belagavi seed so it can run before every single test.
 */
export async function seedReference(): Promise<ReferenceIds> {
  await RoleModel.bulkCreate(ROLES.map((name) => ({ name })));

  await Operator.bulkCreate([
    { name: 'Belagavi Mobility Co-op', code: 'BGM-MOBI' },
    { name: 'Sahyadri Shared Wheels', code: 'SAHYADRI' },
  ]);

  for (const z of ZONES) {
    await testDb.query(
      `INSERT INTO zones (code, name, boundary, centroid, population_ix)
       VALUES (?, ?, ${polygonLiteral(z.boundary).val as string},
               ${pointLiteral(z.centroid).val as string}, ?)`,
      { replacements: [z.code, z.name, z.populationIx] },
    );
  }

  const roles = await RoleModel.findAll();
  const operators = await Operator.findAll({ order: [['code', 'ASC']] });
  const zones = await Zone.findAll();

  return {
    roleIdByName: new Map(roles.map((r) => [r.name, r.id])),
    operatorIds: operators.map((o) => o.id),
    zoneIdByCode: new Map(zones.map((z) => [z.code, z.id])),
  };
}

export interface MakeUserOptions {
  role?: Role;
  roles?: Role[];
  email?: string;
  operatorId?: string | null;
  password?: string;
  status?: 'active' | 'suspended' | 'pending';
}

export async function makeUser(
  options: MakeUserOptions = {},
): Promise<{ user: User; password: string; roles: Role[] }> {
  const roles = options.roles ?? [options.role ?? 'commuter'];
  const password = options.password ?? TEST_PASSWORD;
  const email = options.email ?? `${crypto.randomUUID()}@test.local`;

  const user = await User.create({
    email,
    password_hash: await bcrypt.hash(password, TEST_BCRYPT_COST),
    full_name: 'Test User',
    operator_id: options.operatorId ?? null,
    status: options.status ?? 'active',
  });

  const roleRows = await RoleModel.findAll();
  const idByName = new Map(roleRows.map((r) => [r.name, r.id]));
  for (const r of roles) {
    await UserRole.create({ user_id: user.id, role_id: idByName.get(r)! });
  }

  return { user, password, roles };
}

export interface MakeVehicleOptions {
  operatorId: string;
  homeZoneId?: string | null;
  externalRef?: string;
  type?: VehicleType;
  status?: VehicleStatus;
  batteryPct?: number | null;
}

export async function makeVehicle(options: MakeVehicleOptions): Promise<Vehicle> {
  return Vehicle.create({
    operator_id: options.operatorId,
    home_zone_id: options.homeZoneId ?? null,
    external_ref: options.externalRef ?? `V-${crypto.randomUUID().slice(0, 8)}`,
    type: options.type ?? 'scooter',
    status: options.status ?? 'available',
    battery_pct: options.batteryPct ?? 80,
  });
}

export async function countRows(table: string): Promise<number> {
  const [row] = await testDb.query<{ n: string }>(`SELECT COUNT(*) AS n FROM \`${table}\``, {
    type: QueryTypes.SELECT,
  });
  return Number(row?.n ?? 0);
}
