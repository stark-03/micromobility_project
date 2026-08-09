import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QueryTypes } from 'sequelize';
import { env } from '../../src/config/env.ts';
import { buildSequelize } from '../../src/db/index.ts';
import { runSeed } from '../../src/db/seeders/index.ts';
import { buildSegments, ZONES } from '../../src/db/seeders/belagavi-geo.ts';
import { parsePoint, selectGeom } from '../../src/db/spatial.ts';

const s = buildSequelize(env.db.nameTest);

const COUNTED_TABLES = [
  'roles', 'operators', 'users', 'user_roles', 'user_preferences', 'saved_places',
  'api_keys', 'audit_logs', 'zones', 'road_segments', 'vehicles',
  'vehicle_status_history', 'vehicle_telemetry', 'maintenance_tickets', 'trips',
  'refresh_tokens',
];

async function countAll(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    const [row] = await s.query<{ n: string }>(`SELECT COUNT(*) AS n FROM \`${table}\``, {
      type: QueryTypes.SELECT,
    });
    out[table] = Number(row?.n ?? 0);
  }
  return out;
}

let firstRun: Record<string, number>;
let secondRun: Record<string, number>;

beforeAll(async () => {
  await s.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of COUNTED_TABLES) await s.query(`TRUNCATE TABLE \`${table}\``);
  await s.query('SET FOREIGN_KEY_CHECKS = 1');

  await runSeed({ sequelize: s, quiet: true });
  firstRun = await countAll();

  await runSeed({ sequelize: s, quiet: true });
  secondRun = await countAll();
}, 120_000);

afterAll(async () => {
  await s.close();
});

describe('Belagavi seed', () => {
  it('is idempotent — a second run changes no row count', () => {
    expect(secondRun).toEqual(firstRun);
  });

  it('seeds the counts the spec calls for', () => {
    expect(firstRun.zones).toBe(8);
    expect(firstRun.operators).toBe(2);
    expect(firstRun.vehicles).toBe(60);
    expect(firstRun.users).toBe(5);
    expect(firstRun.trips).toBe(12);
    expect(firstRun.road_segments).toBeGreaterThanOrEqual(115);
    expect(firstRun.roles).toBe(6);
  });

  it('gives every vehicle exactly one creation history row', () => {
    expect(firstRun.vehicle_status_history).toBe(firstRun.vehicles);
  });

  it('grants each demo user exactly one role and one preferences row', () => {
    expect(firstRun.user_roles).toBe(5);
    expect(firstRun.user_preferences).toBe(5);
  });

  it('generates a connected road graph', () => {
    // buildSegments is deterministic, and runSeed calls assertConnected on its
    // output before inserting — so reaching this point at all means it passed.
    const segments = buildSegments();
    expect(segments.length).toBeGreaterThanOrEqual(115);
    expect(new Set(segments.map((x) => x.externalRef)).size).toBe(segments.length);
  });

  it('is deterministic — regenerating produces identical geometry', () => {
    expect(JSON.stringify(buildSegments())).toBe(JSON.stringify(buildSegments()));
  });

  it('places zone centroids where Belagavi actually is', async () => {
    const rows = await s.query<{ code: string; wkt: string }>(
      `SELECT code, ${selectGeom('centroid', 'wkt')} FROM zones ORDER BY code`,
      { type: QueryTypes.SELECT },
    );
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      const p = parsePoint(row.wkt)!;
      // Belagavi sits near 15.85 N, 74.50 E. A transposed axis would put these
      // near 74 N, 15 E — in the Norwegian Sea.
      expect(p.coordinates[0], `${row.code} lng`).toBeGreaterThan(74.4);
      expect(p.coordinates[0], `${row.code} lng`).toBeLessThan(74.6);
      expect(p.coordinates[1], `${row.code} lat`).toBeGreaterThan(15.7);
      expect(p.coordinates[1], `${row.code} lat`).toBeLessThan(15.95);
    }
  });

  it('stores every zone centroid inside its own boundary', async () => {
    const [row] = await s.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM zones WHERE ST_Contains(boundary, centroid) = 0`,
      { type: QueryTypes.SELECT },
    );
    expect(Number(row!.n)).toBe(0);
  });

  it('assigns every vehicle to a real operator and zone', async () => {
    const [row] = await s.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM vehicles v
       LEFT JOIN operators o ON o.id = v.operator_id
       LEFT JOIN zones z     ON z.id = v.home_zone_id
       WHERE o.id IS NULL OR z.id IS NULL`,
      { type: QueryTypes.SELECT },
    );
    expect(Number(row!.n)).toBe(0);
  });

  it('spreads the fleet across all four vehicle types and all eight zones', async () => {
    const types = await s.query<{ type: string; n: string }>(
      'SELECT type, COUNT(*) AS n FROM vehicles GROUP BY type',
      { type: QueryTypes.SELECT },
    );
    expect(types).toHaveLength(4);

    const zones = await s.query<{ home_zone_id: string }>(
      'SELECT DISTINCT home_zone_id FROM vehicles',
      { type: QueryTypes.SELECT },
    );
    expect(zones).toHaveLength(ZONES.length);
  });

  it('writes telemetry only inside the partition range', async () => {
    const [row] = await s.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM vehicle_telemetry WHERE recorded_at >= '2026-12-01'`,
      { type: QueryTypes.SELECT },
    );
    // Everything lands in a named monthly partition, not the pmax catch-all.
    expect(Number(row!.n)).toBe(0);
  });

  it('gives the commuter account trips that ended after they started', async () => {
    const [row] = await s.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM trips WHERE ended_at IS NOT NULL AND ended_at <= started_at`,
      { type: QueryTypes.SELECT },
    );
    expect(Number(row!.n)).toBe(0);
  });
});
