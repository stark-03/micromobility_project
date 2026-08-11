import type { MigrationContext } from '../umzug.ts';

export async function up({ sequelize }: MigrationContext): Promise<void> {
  // DDL from docs/design.md §3.2, verbatim apart from extending the partition
  // range past p2026_08 so the demo data has somewhere to land.
  //
  // Same partitioning constraints as vehicle_telemetry: no foreign keys, no
  // SPATIAL indexes, no GEOMETRY columns. segment_id is indexed only; the
  // geometry lives on road_segments and is joined at read time.
  await sequelize.query(`
    CREATE TABLE traffic_readings (
      id             BIGINT UNSIGNED AUTO_INCREMENT,
      segment_id     BIGINT UNSIGNED   NOT NULL,
      observed_at    DATETIME(3)       NOT NULL,
      mean_speed_kph DECIMAL(6,2)      NULL,
      vehicle_count  SMALLINT UNSIGNED NULL,
      occupancy      DECIMAL(5,4)      NULL,
      source         ENUM('gps','sensor','camera','synthetic') NOT NULL,
      PRIMARY KEY (id, observed_at),
      KEY idx_tr_segment_time (segment_id, observed_at)
    ) ENGINE=InnoDB
    PARTITION BY RANGE (TO_DAYS(observed_at)) (
      PARTITION p2026_08 VALUES LESS THAN (TO_DAYS('2026-09-01')),
      PARTITION p2026_09 VALUES LESS THAN (TO_DAYS('2026-10-01')),
      PARTITION p2026_10 VALUES LESS THAN (TO_DAYS('2026-11-01')),
      PARTITION p2026_11 VALUES LESS THAN (TO_DAYS('2026-12-01')),
      PARTITION pmax     VALUES LESS THAN MAXVALUE
    )
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS traffic_readings');
}
