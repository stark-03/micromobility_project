import type { MigrationContext } from '../umzug.ts';

export async function up({ sequelize }: MigrationContext): Promise<void> {
  // M12: weather as a first-class model feature and simulation input, polled
  // per zone every 15 minutes. Not partitioned — 8 zones x 96 polls/day is
  // ~280k rows/year, which a laptop MySQL handles without help.
  await sequelize.query(`
    CREATE TABLE weather_readings (
      id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      zone_id           BIGINT UNSIGNED NOT NULL,
      observed_at       DATETIME(3)     NOT NULL,
      temp_c            DECIMAL(5,2)    NULL,
      precipitation_mm  DECIMAL(6,2)    NULL,
      wind_kph          DECIMAL(5,2)    NULL,
      visibility_m      MEDIUMINT UNSIGNED NULL,
      condition_code    VARCHAR(32)     NULL,
      source            ENUM('api','synthetic') NOT NULL DEFAULT 'synthetic',
      created_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_wr_zone_time (zone_id, observed_at),
      KEY idx_wr_zone_time (zone_id, observed_at),
      CONSTRAINT fk_wr_zone FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS weather_readings');
}
