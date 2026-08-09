import { QueryTypes } from 'sequelize';
import { env } from '../../src/config/env.ts';
import { buildSequelize } from '../../src/db/index.ts';
import { ensureModels } from '../../src/db/models/index.ts';

const TARGET = env.db.nameTest;

/**
 * GUARD 1 — configuration.
 *
 * This machine's MySQL hosts ~15 unrelated project databases. A truncate helper
 * pointed at the wrong schema destroys someone else's work, so refuse to load
 * at all unless the target is explicitly a *_test schema.
 */
if (!TARGET.endsWith('_test')) {
  throw new Error(
    `Refusing to load the test DB helper: DB_NAME_TEST is "${TARGET}", ` +
      'which does not end in _test. Truncation would be catastrophic.',
  );
}

export const testDb = buildSequelize(TARGET);
ensureModels(testDb);

/**
 * Child-table-first. FK checks are disabled during the sweep, but keeping the
 * order correct means this still works if that ever stops being true.
 */
const TABLES = [
  'vehicle_telemetry',
  'vehicle_status_history',
  'maintenance_tickets',
  'trips',
  'saved_places',
  'user_preferences',
  'refresh_tokens',
  'user_roles',
  'audit_logs',
  'api_keys',
  'vehicles',
  'road_segments',
  'users',
  'zones',
  'operators',
  'roles',
];

export async function truncateAll(): Promise<void> {
  /**
   * GUARD 2 — the live connection.
   *
   * Checked separately from GUARD 1 because the two can disagree: .env may be
   * edited between module load and this call, and a pooled connection could in
   * principle have been built against a different schema.
   */
  const current = await testDb.query<{ db: string | null }>('SELECT DATABASE() AS db', {
    type: QueryTypes.SELECT,
    plain: true,
  });
  if (!current?.db?.endsWith('_test')) {
    throw new Error(
      `Connected schema is "${current?.db}", not a _test schema — aborting truncate.`,
    );
  }

  await testDb.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const t of TABLES) await testDb.query(`TRUNCATE TABLE \`${t}\``);
  } finally {
    await testDb.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

export { TABLES as TRUNCATABLE_TABLES };
