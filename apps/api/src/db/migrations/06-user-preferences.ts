import type { MigrationContext } from '../umzug.ts';

export async function up({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query(`
    CREATE TABLE user_preferences (
      user_id                BIGINT UNSIGNED NOT NULL PRIMARY KEY,
      language               VARCHAR(8) NOT NULL DEFAULT 'en',
      units                  ENUM('metric','imperial') NOT NULL DEFAULT 'metric',
      preferred_vehicle_type ENUM('scooter','bike','ebike','ev') NULL,
      theme                  ENUM('dark','light') NOT NULL DEFAULT 'dark',
      notifications_enabled  BOOLEAN     NOT NULL DEFAULT 1,
      created_at             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      CONSTRAINT fk_up_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS user_preferences');
}
