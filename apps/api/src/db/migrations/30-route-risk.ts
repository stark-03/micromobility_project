import type { MigrationContext } from '../umzug.ts';

/**
 * M09 inputs for route risk: accident history and road surface quality.
 *
 * Lighting (`lit`), cycling infrastructure (`has_bike_lane`, `road_class`) and
 * traffic (`traffic_snapshots`) already exist. These are the two inputs that
 * did not.
 *
 * `surface_quality` is 1 (broken) to 5 (good) and nullable: an unsurveyed road
 * is unknown, not average, and the risk model says so rather than guessing.
 */
export async function up({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query(`
    CREATE TABLE incidents (
      id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      segment_id   BIGINT UNSIGNED NULL,
      occurred_at  DATETIME(3)     NOT NULL,
      location     POINT           NOT NULL SRID 4326,
      severity     ENUM('minor','serious','fatal') NOT NULL,
      kind         ENUM('collision','fall','near_miss','other') NOT NULL,
      /** Where the record came from: police data, operator report, synthetic seed. */
      source       VARCHAR(32)     NOT NULL,
      created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      SPATIAL INDEX idx_incidents_location (location),
      KEY idx_incidents_segment_time (segment_id, occurred_at),
      CONSTRAINT fk_incidents_segment FOREIGN KEY (segment_id)
        REFERENCES road_segments(id) ON DELETE SET NULL
    ) ENGINE=InnoDB
  `);

  await sequelize.query(`
    ALTER TABLE road_segments
      ADD COLUMN surface_quality TINYINT UNSIGNED NULL AFTER lit,
      ADD CONSTRAINT chk_rs_surface_quality CHECK (surface_quality BETWEEN 1 AND 5)
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query(`
    ALTER TABLE road_segments
      DROP CHECK chk_rs_surface_quality,
      DROP COLUMN surface_quality
  `);
  await sequelize.query('DROP TABLE IF EXISTS incidents');
}
