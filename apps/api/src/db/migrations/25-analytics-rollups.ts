import type { MigrationContext } from '../umzug.ts';

/**
 * M11 analytics + M10 environmental.
 *
 * CLAUDE.md: "Aggregation endpoints backed by nightly rollup tables — never
 * GROUP BY over raw telemetry at request time." These are those tables. The
 * dashboard reads them and nothing else; the nightly job is the only writer.
 */
export async function up({ sequelize }: MigrationContext): Promise<void> {
  /**
   * Emission factors as data, not constants.
   *
   * MODULES.md M10 wants the car-baseline factor "configurable, cited". A
   * number that decides how green the city looks must be arguable — a planner
   * who disagrees with 120 g/km should be able to change it and see the effect,
   * not read it out of a source file.
   */
  await sequelize.query(`
    CREATE TABLE emission_factors (
      id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      mode          VARCHAR(32)   NOT NULL,
      /** Grams CO2e per passenger-kilometre. */
      g_co2e_per_km DECIMAL(8,3)  NOT NULL,
      /** Watt-hours per kilometre. Zero for a pedal bike. */
      wh_per_km     DECIMAL(8,3)  NOT NULL DEFAULT 0.000,
      /** Where the number came from. Required — an uncited factor is a guess. */
      source        VARCHAR(255)  NOT NULL,
      valid_from    DATE          NOT NULL,
      created_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_factor_mode_from (mode, valid_from)
    ) ENGINE=InnoDB
  `);

  await sequelize.query(`
    CREATE TABLE kpi_daily (
      id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      day                 DATE          NOT NULL,
      trips               INT UNSIGNED  NOT NULL DEFAULT 0,
      distance_km         DECIMAL(14,3) NOT NULL DEFAULT 0.000,
      duration_min        DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      active_vehicles     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      /** Trips per active vehicle per day — the operator's headline number. */
      trips_per_vehicle   DECIMAL(8,3)  NOT NULL DEFAULT 0.000,
      mean_trip_km        DECIMAL(8,3)  NOT NULL DEFAULT 0.000,
      mean_trip_min       DECIMAL(8,2)  NOT NULL DEFAULT 0.00,
      energy_kwh          DECIMAL(14,3) NOT NULL DEFAULT 0.000,
      co2e_avoided_kg     DECIMAL(14,3) NOT NULL DEFAULT 0.000,
      /** Modal split as {"scooter":0.51,"ebike":0.3,"bike":0.19}. */
      modal_split         JSON          NULL,
      computed_at         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_kpi_day (day)
    ) ENGINE=InnoDB
  `);

  await sequelize.query(`
    CREATE TABLE zone_daily_rollups (
      id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      day             DATE          NOT NULL,
      zone_id         BIGINT UNSIGNED NOT NULL,
      trips_started   INT UNSIGNED  NOT NULL DEFAULT 0,
      trips_ended     INT UNSIGNED  NOT NULL DEFAULT 0,
      /** trips_ended - trips_started. Persistently negative = drains overnight. */
      net_flow        INT           NOT NULL DEFAULT 0,
      distance_km     DECIMAL(14,3) NOT NULL DEFAULT 0.000,
      co2e_avoided_kg DECIMAL(14,3) NOT NULL DEFAULT 0.000,
      computed_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_zone_day (day, zone_id),
      CONSTRAINT fk_zdr_zone FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  // Cited factors. Sources are named because M10's whole output is a claim
  // about avoided emissions, and an uncited claim is not worth publishing.
  await sequelize.query(`
    INSERT INTO emission_factors (mode, g_co2e_per_km, wh_per_km, source, valid_from) VALUES
      ('car',     120.000, 0.000,  'Indian passenger car fleet average, MoRTH/CPCB estimates', '2026-01-01'),
      ('scooter',  22.000, 32.000, 'Shared e-scooter LCA, amortised over service life (Hollingsworth 2019)', '2026-01-01'),
      ('ebike',    18.000, 12.000, 'Shared e-bike LCA, amortised over service life', '2026-01-01'),
      ('bike',      0.000, 0.000,  'Human powered; no operational emissions', '2026-01-01')
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS zone_daily_rollups');
  await sequelize.query('DROP TABLE IF EXISTS kpi_daily');
  await sequelize.query('DROP TABLE IF EXISTS emission_factors');
}
