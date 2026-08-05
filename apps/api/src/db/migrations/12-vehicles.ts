import type { MigrationContext } from '../umzug.ts';

// DDL copied verbatim from docs/design.md §3.2.
export async function up({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query(`
    CREATE TABLE vehicles (
      id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      operator_id   BIGINT UNSIGNED   NOT NULL,
      home_zone_id  BIGINT UNSIGNED   NULL,
      external_ref  VARCHAR(64)       NOT NULL,
      type          ENUM('scooter','bike','ebike','ev')      NOT NULL,
      status        ENUM('available','reserved','in_use','returning',
                         'charging','maintenance','retired')  NOT NULL DEFAULT 'available',
      battery_pct   TINYINT UNSIGNED  NULL,
      last_seen_at  DATETIME(3)       NULL,
      last_position POINT             NULL SRID 4326,
      deleted_at    DATETIME(3)       NULL,
      created_at    DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at    DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                      ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_vehicle_ref (operator_id, external_ref),
      KEY idx_vehicles_status_zone (status, home_zone_id),
      CONSTRAINT fk_vehicles_operator FOREIGN KEY (operator_id) REFERENCES operators(id),
      CONSTRAINT fk_vehicles_zone     FOREIGN KEY (home_zone_id) REFERENCES zones(id)
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS vehicles');
}
