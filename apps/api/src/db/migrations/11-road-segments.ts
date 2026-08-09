import type { MigrationContext } from '../umzug.ts';

export async function up({ sequelize }: MigrationContext): Promise<void> {
  // design.md §3.2 gives no DDL for this table; it is designed in
  // docs/superpowers/specs/2026-08-05-sprint-1-design.md §4.3 to carry M02's
  // readings, M04's A* graph and M09's safety scores without a later migration
  // against a populated table.
  //
  // from_node/to_node are graph vertex labels, not FKs — there is no `nodes`
  // table; A* builds its adjacency from these two columns.
  await sequelize.query(`
    CREATE TABLE road_segments (
      id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      zone_id         BIGINT UNSIGNED  NULL,
      name            VARCHAR(160)     NULL,
      external_ref    VARCHAR(64)      NULL,
      from_node       VARCHAR(32)      NOT NULL,
      to_node         VARCHAR(32)      NOT NULL,
      geometry        LINESTRING       NOT NULL SRID 4326,
      length_m        DECIMAL(10,2)    NOT NULL,
      speed_free_kph  DECIMAL(5,2)     NOT NULL,
      lanes           TINYINT UNSIGNED NOT NULL DEFAULT 1,
      one_way         BOOLEAN          NOT NULL DEFAULT 0,
      gradient_pct    DECIMAL(5,2)     NOT NULL DEFAULT 0.00,
      road_class      ENUM('arterial','collector','local','path','cycleway') NOT NULL,
      has_bike_lane   BOOLEAN          NOT NULL DEFAULT 0,
      lit             BOOLEAN          NOT NULL DEFAULT 1,
      created_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                       ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_rs_external_ref (external_ref),
      SPATIAL INDEX idx_rs_geometry (geometry),
      KEY idx_rs_zone (zone_id),
      KEY idx_rs_nodes (from_node, to_node),
      CONSTRAINT fk_rs_zone FOREIGN KEY (zone_id) REFERENCES zones(id)
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS road_segments');
}
