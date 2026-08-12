import type { MigrationContext } from '../umzug.ts';

export async function up({ sequelize }: MigrationContext): Promise<void> {
  // Forecast demand per zone per 15-minute slot (MODULES.md M05).
  //
  // design.md §1: forecasts ship with intervals and a model version, never a
  // bare number — so p10/p90 and model_version are NOT NULL-by-convention here
  // rather than optional extras.
  await sequelize.query(`
    CREATE TABLE demand_forecasts (
      id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      zone_id        BIGINT UNSIGNED NOT NULL,
      slot_start     DATETIME(3)   NOT NULL,
      horizon_min    SMALLINT UNSIGNED NOT NULL,
      predicted_trips DECIMAL(8,3) NOT NULL,
      p10            DECIMAL(8,3)  NULL,
      p90            DECIMAL(8,3)  NULL,
      model_version  VARCHAR(64)   NOT NULL,
      generated_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      created_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_df_zone_slot_model (zone_id, slot_start, model_version),
      KEY idx_df_zone_slot (zone_id, slot_start),
      CONSTRAINT fk_df_zone FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS demand_forecasts');
}
