import type { MigrationContext } from '../umzug.ts';

export async function up({ sequelize }: MigrationContext): Promise<void> {
  // Current traffic state per segment — the table the map actually reads.
  //
  // design.md §3.3: raw telemetry is written once and never scanned by the UI.
  // A worker rolls the last two minutes of traffic_readings into this table;
  // GET /traffic/live reads only from here, which is what keeps the p95 under
  // the 200 ms target in §8.
  //
  // Not partitioned and not append-only: exactly one row per segment, upserted.
  await sequelize.query(`
    CREATE TABLE traffic_snapshots (
      id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      segment_id       BIGINT UNSIGNED   NOT NULL,
      zone_id          BIGINT UNSIGNED   NULL,
      computed_at      DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      mean_speed_kph   DECIMAL(6,2)      NULL,
      vehicle_count    SMALLINT UNSIGNED NULL,
      occupancy        DECIMAL(5,4)      NULL,
      -- 0.000 = free flow, 1.000 = jammed. Drives the --flow-* ramp.
      congestion_index DECIMAL(4,3)      NOT NULL DEFAULT 0.000,
      sample_count     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      created_at       DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at       DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                         ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_ts_segment (segment_id),
      KEY idx_ts_zone (zone_id),
      KEY idx_ts_congestion (congestion_index),
      CONSTRAINT fk_ts_segment FOREIGN KEY (segment_id) REFERENCES road_segments(id) ON DELETE CASCADE,
      CONSTRAINT fk_ts_zone    FOREIGN KEY (zone_id)    REFERENCES zones(id)
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS traffic_snapshots');
}
