import type { MigrationContext } from '../umzug.ts';

export async function up({ sequelize }: MigrationContext): Promise<void> {
  // user_id is nullable because design.md §7 requires the user link to be
  // dropped from analytics. public_ref is the pseudonymous handle downstream
  // tables reference instead. No fares here — that is M14, Sprint 6.
  await sequelize.query(`
    CREATE TABLE trips (
      id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      public_ref     CHAR(36)        NOT NULL,
      user_id        BIGINT UNSIGNED NULL,
      vehicle_id     BIGINT UNSIGNED NOT NULL,
      operator_id    BIGINT UNSIGNED NOT NULL,
      start_zone_id  BIGINT UNSIGNED NULL,
      end_zone_id    BIGINT UNSIGNED NULL,
      started_at     DATETIME(3)     NOT NULL,
      ended_at       DATETIME(3)     NULL,
      start_position POINT           NULL SRID 4326,
      end_position   POINT           NULL SRID 4326,
      distance_m     DECIMAL(10,2)   NULL,
      duration_s     INT UNSIGNED    NULL,
      status         ENUM('active','completed','cancelled') NOT NULL DEFAULT 'active',
      created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_trips_ref (public_ref),
      KEY idx_trips_user_time (user_id, started_at),
      KEY idx_trips_vehicle_time (vehicle_id, started_at),
      KEY idx_trips_operator (operator_id),
      CONSTRAINT fk_trips_user       FOREIGN KEY (user_id)       REFERENCES users(id),
      CONSTRAINT fk_trips_vehicle    FOREIGN KEY (vehicle_id)    REFERENCES vehicles(id),
      CONSTRAINT fk_trips_operator   FOREIGN KEY (operator_id)   REFERENCES operators(id),
      CONSTRAINT fk_trips_start_zone FOREIGN KEY (start_zone_id) REFERENCES zones(id),
      CONSTRAINT fk_trips_end_zone   FOREIGN KEY (end_zone_id)   REFERENCES zones(id)
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS trips');
}
