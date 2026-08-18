import type { MigrationContext } from '../umzug.ts';

/**
 * Charging stations — the infrastructure the simulator kept asking for.
 *
 * Worth recording why this table exists: every unmet trip in the seeded
 * baseline scenario is reason code `battery`, not `no_vehicle`. The simulator's
 * own finding was that the constraint is charge, not fleet size. This is the
 * first module built in response to something the system discovered rather than
 * something the spec listed.
 *
 * A planner places stations on the map; riders see the ones near their route.
 */
export async function up({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query(`
    CREATE TABLE charging_stations (
      id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name         VARCHAR(120)  NOT NULL,
      zone_id      BIGINT UNSIGNED NULL,
      /** SRID 4326. Always read and written through db/spatial.ts. */
      location     POINT         NOT NULL SRID 4326,
      /** How many vehicles can charge at once. */
      connectors   SMALLINT UNSIGNED NOT NULL DEFAULT 4,
      power_kw     DECIMAL(6,2)  NOT NULL DEFAULT 3.30,
      status       ENUM('active','offline','planned') NOT NULL DEFAULT 'active',
      notes        VARCHAR(255)  NULL,
      created_by   BIGINT UNSIGNED NULL,
      created_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      deleted_at   DATETIME(3)   NULL,
      SPATIAL INDEX idx_cs_location (location),
      KEY idx_cs_live (deleted_at, status),
      CONSTRAINT fk_cs_zone FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE SET NULL,
      CONSTRAINT fk_cs_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS charging_stations');
}
