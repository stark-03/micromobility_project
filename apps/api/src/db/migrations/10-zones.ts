import type { MigrationContext } from '../umzug.ts';

// DDL copied verbatim from docs/design.md §3.2.
export async function up({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query(`
    CREATE TABLE zones (
      id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name          VARCHAR(120)      NOT NULL,
      code          VARCHAR(32)       NOT NULL UNIQUE,
      boundary      POLYGON           NOT NULL SRID 4326,
      centroid      POINT             NOT NULL SRID 4326,
      population_ix DECIMAL(6,3)      NULL,
      created_at    DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at    DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                      ON UPDATE CURRENT_TIMESTAMP(3),
      SPATIAL INDEX idx_zones_boundary (boundary)
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS zones');
}
