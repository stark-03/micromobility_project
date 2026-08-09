import type { MigrationContext } from '../umzug.ts';

export async function up({ sequelize }: MigrationContext): Promise<void> {
  // Partitioned, mirroring traffic_readings in design.md §3.2.
  //
  // MySQL forbids THREE things on partitioned tables, and all three bite here:
  //   1. Foreign keys. vehicle_id is indexed but not FK-constrained; integrity
  //      is enforced in the service layer. Adding a constraint fails the CREATE.
  //   2. SPATIAL indexes.
  //   3. GEOMETRY columns at all — not merely their indexes. A POINT column
  //      here fails with ER_CHECK_NOT_IMPLEMENTED, "The storage engine for the
  //      table doesn't support GEOMETRY".
  //
  // So position is stored as lat/lng DECIMAL rather than a POINT. Six decimal
  // places is ~0.11 m, well inside GPS error. The DTO mapper rebuilds a GeoPoint
  // so the API contract is identical to every other positioned entity, and
  // nothing is lost: telemetry is only ever queried by vehicle_id + time range,
  // never spatially. Note traffic_readings in design.md §3.2 carries no geometry
  // column either, for the same reason.
  //
  // The monthly partition-maintenance job is Sprint 2 work. pmax catches
  // everything until it lands.
  await sequelize.query(`
    CREATE TABLE vehicle_telemetry (
      id          BIGINT UNSIGNED AUTO_INCREMENT,
      vehicle_id  BIGINT UNSIGNED  NOT NULL,
      recorded_at DATETIME(3)      NOT NULL,
      lat         DECIMAL(9,6)     NULL,
      lng         DECIMAL(10,6)    NULL,
      speed_kph   DECIMAL(5,2)     NULL,
      battery_pct TINYINT UNSIGNED NULL,
      odometer_m  BIGINT UNSIGNED  NULL,
      lock_state  ENUM('locked','unlocked') NULL,
      fault_code  VARCHAR(32)      NULL,
      source      ENUM('gps','sensor','synthetic') NOT NULL DEFAULT 'gps',
      PRIMARY KEY (id, recorded_at),
      KEY idx_vt_vehicle_time (vehicle_id, recorded_at)
    ) ENGINE=InnoDB
    PARTITION BY RANGE (TO_DAYS(recorded_at)) (
      PARTITION p2026_08 VALUES LESS THAN (TO_DAYS('2026-09-01')),
      PARTITION p2026_09 VALUES LESS THAN (TO_DAYS('2026-10-01')),
      PARTITION p2026_10 VALUES LESS THAN (TO_DAYS('2026-11-01')),
      PARTITION p2026_11 VALUES LESS THAN (TO_DAYS('2026-12-01')),
      PARTITION pmax     VALUES LESS THAN MAXVALUE
    )
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS vehicle_telemetry');
}
