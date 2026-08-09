import type { MigrationContext } from '../umzug.ts';

export async function up({ sequelize }: MigrationContext): Promise<void> {
  // Forecast horizon per zone, used by the scenario builder in Sprint 4.
  // (zone_id, forecast_for) is unique so a re-poll replaces its own prediction
  // rather than stacking duplicates.
  await sequelize.query(`
    CREATE TABLE weather_forecasts (
      id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      zone_id          BIGINT UNSIGNED NOT NULL,
      issued_at        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      forecast_for     DATETIME(3)     NOT NULL,
      temp_c           DECIMAL(5,2)    NULL,
      precipitation_mm DECIMAL(6,2)    NULL,
      wind_kph         DECIMAL(5,2)    NULL,
      condition_code   VARCHAR(32)     NULL,
      created_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                       ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_wf_zone_for (zone_id, forecast_for),
      KEY idx_wf_zone_time (zone_id, forecast_for),
      CONSTRAINT fk_wf_zone FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS weather_forecasts');
}
