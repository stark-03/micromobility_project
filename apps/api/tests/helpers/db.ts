import { QueryTypes } from 'sequelize';
import { activeDbName, env } from '../../src/config/env.ts';
import { sequelize } from '../../src/db/index.ts';
import { ensureModels } from '../../src/db/models/index.ts';

/**
 * GUARD 1 — configuration.
 *
 * This machine's MySQL hosts ~15 unrelated project databases. A truncate helper
 * pointed at the wrong schema destroys someone else's work, so refuse to load
 * at all unless the target is explicitly a *_test schema.
 */
if (!env.db.nameTest.endsWith('_test')) {
  throw new Error(
    `Refusing to load the test DB helper: DB_NAME_TEST is "${env.db.nameTest}", ` +
      'which does not end in _test. Truncation would be catastrophic.',
  );
}

/**
 * GUARD 2 — the process is actually in test mode.
 *
 * Without NODE_ENV=test the app's Sequelize instance points at the DEV schema,
 * and truncating would wipe the seeded Belagavi city.
 */
if (!activeDbName.endsWith('_test')) {
  throw new Error(
    `Refusing to load the test DB helper: the app is connected to "${activeDbName}". ` +
      'Run tests with NODE_ENV=test.',
  );
}

/**
 * Deliberately the APPLICATION'S Sequelize instance, not a second one.
 *
 * Services open transactions on this instance (`sequelize.transaction(...)`).
 * If tests bound the models to a different instance, a transaction handle from
 * one pool would be passed to queries running on another — locks would not
 * apply, and rollbacks would silently fail to undo anything. That bug is
 * invisible to a model smoke test and shows up much later as flaky isolation.
 */
export const testDb = sequelize;
ensureModels(testDb);

/**
 * Child-table-first. FK checks are disabled during the sweep, but keeping the
 * order correct means this still works if that ever stops being true.
 */
const TABLES = [
  // Rentals: points and payments reference trips; incidents reference segments.
  'trip_points',
  'payments',
  'incidents',
  // Charging infrastructure. References zones and users.
  'charging_stations',
  // M11/M10 rollups. Derived data; safe to wipe between tests.
  'zone_daily_rollups',
  'kpi_daily',
  // M07. Tasks and snapshots reference plans, zones and users.
  'rebalance_tasks',
  'zone_supply_snapshots',
  'charging_tasks',
  'rebalance_plans',
  // M06. Children before parents; scenarios must go before users, which they
  // reference via created_by.
  'simulation_metrics',
  'simulation_events',
  'simulation_runs',
  'scenarios',
  'traffic_readings',
  'traffic_snapshots',
  'weather_readings',
  'weather_forecasts',
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
  // After vehicles and trips, which reference it. pricing_plans is reference
  // data seeded by its migration, like emission_factors, and is never truncated.
  'rental_stations',
  'road_segments',
  'users',
  'zones',
  'operators',
  'roles',
];

export async function truncateAll(): Promise<void> {
  /**
   * GUARD 3 — the live connection.
   *
   * Checked separately because configuration and reality can disagree: .env may
   * be edited between module load and this call.
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
