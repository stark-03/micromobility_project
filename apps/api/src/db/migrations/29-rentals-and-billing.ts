import type { MigrationContext } from '../umzug.ts';

/**
 * Renting a vehicle end to end: tariffs, the fare on the trip, the GPS trace
 * of the ride, and the payment that settles it.
 *
 * Money is DECIMAL(12,4) in the database and integer paise in the API
 * (CLAUDE.md). No card data exists anywhere in this schema: a payment row holds
 * the provider's reference and nothing a provider would call sensitive.
 */
export async function up({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query(`
    CREATE TABLE pricing_plans (
      id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      vehicle_type    ENUM('scooter','bike','ebike','ev') NOT NULL,
      name            VARCHAR(80)   NOT NULL,
      currency        CHAR(3)       NOT NULL DEFAULT 'INR',
      unlock_fee      DECIMAL(12,4) NOT NULL,
      per_minute      DECIMAL(12,4) NOT NULL,
      /** A short ride still costs at least this much. */
      minimum_fare    DECIMAL(12,4) NOT NULL,
      active          BOOLEAN       NOT NULL DEFAULT 1,
      created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_pricing_active (vehicle_type, active)
    ) ENGINE=InnoDB
  `);

  // Reference data, seeded here like emission_factors rather than in the demo
  // seeder: renting cannot work without a tariff, so a migrated-but-unseeded
  // database must still be able to quote a fare. Demo figures, not a real
  // operator's price list.
  await sequelize.query(`
    INSERT INTO pricing_plans (vehicle_type, name, unlock_fee, per_minute, minimum_fare) VALUES
      ('bike',    'Pedal bike — pay as you go',  5.0000, 1.0000, 10.0000),
      ('scooter', 'E-scooter — pay as you go',  10.0000, 2.0000, 20.0000),
      ('ebike',   'E-bike — pay as you go',     10.0000, 1.5000, 20.0000),
      ('ev',      'Micro-EV — pay as you go',   25.0000, 4.0000, 50.0000)
  `);

  /**
   * The trip becomes a rental.
   *
   * `active_user_id` and `active_vehicle_id` are generated columns that hold a
   * value only while the trip is active, with a UNIQUE key on each. That makes
   * "one active rental per rider" and "one rider per vehicle" properties of
   * the schema rather than of a read-then-write in the service — two taps on
   * Unlock cannot both succeed, however they interleave.
   */
  await sequelize.query(`
    ALTER TABLE trips
      ADD COLUMN start_station_id  BIGINT UNSIGNED NULL AFTER end_zone_id,
      ADD COLUMN end_station_id    BIGINT UNSIGNED NULL AFTER start_station_id,
      ADD COLUMN pricing_plan_id   BIGINT UNSIGNED NULL AFTER end_station_id,
      ADD COLUMN start_battery_pct TINYINT UNSIGNED NULL AFTER duration_s,
      ADD COLUMN end_battery_pct   TINYINT UNSIGNED NULL AFTER start_battery_pct,
      ADD COLUMN fare_total        DECIMAL(12,4)  NULL AFTER end_battery_pct,
      ADD COLUMN fare_breakdown    JSON           NULL AFTER fare_total,
      ADD COLUMN energy_wh         DECIMAL(10,2)  NULL AFTER fare_breakdown,
      ADD COLUMN co2_saved_g       DECIMAL(10,2)  NULL AFTER energy_wh,
      ADD COLUMN active_user_id    BIGINT UNSIGNED
        GENERATED ALWAYS AS (IF(status = 'active', user_id, NULL)) STORED,
      ADD COLUMN active_vehicle_id BIGINT UNSIGNED
        GENERATED ALWAYS AS (IF(status = 'active', vehicle_id, NULL)) STORED,
      ADD UNIQUE KEY uq_trips_one_active_per_user (active_user_id),
      ADD UNIQUE KEY uq_trips_one_active_per_vehicle (active_vehicle_id),
      ADD CONSTRAINT fk_trips_start_station FOREIGN KEY (start_station_id)
        REFERENCES rental_stations(id) ON DELETE SET NULL,
      ADD CONSTRAINT fk_trips_end_station FOREIGN KEY (end_station_id)
        REFERENCES rental_stations(id) ON DELETE SET NULL,
      ADD CONSTRAINT fk_trips_pricing_plan FOREIGN KEY (pricing_plan_id)
        REFERENCES pricing_plans(id)
  `);

  /**
   * The GPS trace of a ride.
   *
   * Sensitive: a trace tied to a user is a record of where a person went.
   * It is read back only by that rider (their own journey) and never logged
   * (CLAUDE.md guardrails). Analytics tables get aggregates, not this.
   */
  await sequelize.query(`
    CREATE TABLE trip_points (
      id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      trip_id      BIGINT UNSIGNED NOT NULL,
      recorded_at  DATETIME(3)     NOT NULL,
      position     POINT           NOT NULL SRID 4326,
      speed_kph    DECIMAL(5,2)    NULL,
      accuracy_m   DECIMAL(7,2)    NULL,
      source       ENUM('gps','simulated') NOT NULL DEFAULT 'gps',
      created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_trip_points_trip_time (trip_id, recorded_at),
      CONSTRAINT fk_trip_points_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await sequelize.query(`
    CREATE TABLE payments (
      id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id       BIGINT UNSIGNED NOT NULL,
      trip_id       BIGINT UNSIGNED NOT NULL,
      amount        DECIMAL(12,4)   NOT NULL,
      currency      CHAR(3)         NOT NULL DEFAULT 'INR',
      /** Which adapter took the payment: 'mock' until a real gateway is wired in. */
      provider      VARCHAR(32)     NOT NULL,
      /** The provider's own id for the charge — the only thing we keep. */
      provider_ref  VARCHAR(64)     NULL,
      status        ENUM('pending','succeeded','failed') NOT NULL DEFAULT 'pending',
      failure_reason VARCHAR(255)   NULL,
      created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_payments_trip (trip_id),
      KEY idx_payments_user_time (user_id, created_at),
      CONSTRAINT fk_payments_user FOREIGN KEY (user_id) REFERENCES users(id),
      CONSTRAINT fk_payments_trip FOREIGN KEY (trip_id) REFERENCES trips(id)
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS payments');
  await sequelize.query('DROP TABLE IF EXISTS trip_points');
  await sequelize.query(`
    ALTER TABLE trips
      DROP FOREIGN KEY fk_trips_start_station,
      DROP FOREIGN KEY fk_trips_end_station,
      DROP FOREIGN KEY fk_trips_pricing_plan,
      DROP KEY uq_trips_one_active_per_user,
      DROP KEY uq_trips_one_active_per_vehicle,
      DROP COLUMN active_vehicle_id,
      DROP COLUMN active_user_id,
      DROP COLUMN co2_saved_g,
      DROP COLUMN energy_wh,
      DROP COLUMN fare_breakdown,
      DROP COLUMN fare_total,
      DROP COLUMN end_battery_pct,
      DROP COLUMN start_battery_pct,
      DROP COLUMN pricing_plan_id,
      DROP COLUMN end_station_id,
      DROP COLUMN start_station_id
  `);
  await sequelize.query('DROP TABLE IF EXISTS pricing_plans');
}
