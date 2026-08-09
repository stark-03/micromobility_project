import type { MigrationContext } from '../umzug.ts';

export async function up({ sequelize }: MigrationContext): Promise<void> {
  // SPATIAL INDEX requires the column to be NOT NULL.
  await sequelize.query(`
    CREATE TABLE saved_places (
      id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id    BIGINT UNSIGNED NOT NULL,
      label      VARCHAR(80)  NOT NULL,
      address    VARCHAR(255) NULL,
      position   POINT        NOT NULL SRID 4326,
      kind       ENUM('home','work','other') NOT NULL DEFAULT 'other',
      created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_sp_user_label (user_id, label),
      SPATIAL INDEX idx_sp_position (position),
      CONSTRAINT fk_sp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS saved_places');
}
