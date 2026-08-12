import type { MigrationContext } from '../umzug.ts';

export async function up({ sequelize }: MigrationContext): Promise<void> {
  // M05. design.md §4: a model that ships records its metrics here, and one
  // with no recorded eval does not get an is_active flag.
  await sequelize.query(`
    CREATE TABLE model_registry (
      id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name          VARCHAR(64)  NOT NULL,
      version       VARCHAR(64)  NOT NULL,
      kind          ENUM('demand','congestion','anomaly','rebalance') NOT NULL,
      algorithm     VARCHAR(64)  NOT NULL,
      -- Chronological split boundaries, kept so a claim can be audited.
      trained_from  DATETIME(3)  NOT NULL,
      trained_to    DATETIME(3)  NOT NULL,
      valid_from    DATETIME(3)  NOT NULL,
      valid_to      DATETIME(3)  NOT NULL,
      train_rows    INT UNSIGNED NOT NULL,
      valid_rows    INT UNSIGNED NOT NULL,
      mae           DECIMAL(10,4) NULL,
      rmse          DECIMAL(10,4) NULL,
      mape          DECIMAL(10,4) NULL,
      baseline_mae  DECIMAL(10,4) NULL,
      /** Ratio model MAE / baseline MAE. design.md §4 wants <= 0.7 to ship. */
      skill_ratio   DECIMAL(10,4) NULL,
      is_active     BOOLEAN      NOT NULL DEFAULT 0,
      artifact_path VARCHAR(255) NULL,
      features      JSON         NULL,
      notes         TEXT         NULL,
      created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_model_name_version (name, version),
      KEY idx_model_kind_active (kind, is_active)
    ) ENGINE=InnoDB
  `);

  await sequelize.query(`
    CREATE TABLE model_runs (
      id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      model_id      BIGINT UNSIGNED NULL,
      kind          ENUM('train','evaluate','predict') NOT NULL,
      status        ENUM('queued','running','completed','failed') NOT NULL DEFAULT 'queued',
      started_at    DATETIME(3)  NULL,
      finished_at   DATETIME(3)  NULL,
      duration_ms   INT UNSIGNED NULL,
      metrics       JSON         NULL,
      error         TEXT         NULL,
      triggered_by  BIGINT UNSIGNED NULL,
      created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY idx_runs_model (model_id, created_at),
      KEY idx_runs_status (status, created_at),
      CONSTRAINT fk_model_runs_model FOREIGN KEY (model_id) REFERENCES model_registry(id) ON DELETE SET NULL,
      CONSTRAINT fk_model_runs_user  FOREIGN KEY (triggered_by) REFERENCES users(id)
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS model_runs');
  await sequelize.query('DROP TABLE IF EXISTS model_registry');
}
