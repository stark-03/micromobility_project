import type { MigrationContext } from '../umzug.ts';

/**
 * Adds the missing `ev` emission factor.
 *
 * Migration 25 seeded factors for scooter, ebike and bike but not `ev`, which
 * is the fourth member of VEHICLE_TYPES. The effect was not a crash but
 * something worse: every shared-EV trip contributed exactly zero to both the
 * energy total and the CO2-avoided total, silently understating the headline
 * environmental claim by a quarter of the fleet's mileage.
 *
 * Migrations are immutable once merged (CLAUDE.md), so this fixes forward.
 */
export async function up({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query(`
    INSERT INTO emission_factors (mode, g_co2e_per_km, wh_per_km, source, valid_from)
    VALUES ('ev', 48.000, 150.000,
            'Shared micro-EV (quadricycle) on the Indian grid mix, ~0.71 kg CO2e/kWh (CEA)',
            '2026-01-01')
    ON DUPLICATE KEY UPDATE
      g_co2e_per_km = VALUES(g_co2e_per_km),
      wh_per_km     = VALUES(wh_per_km),
      source        = VALUES(source)
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query(`DELETE FROM emission_factors WHERE mode = 'ev'`);
}
