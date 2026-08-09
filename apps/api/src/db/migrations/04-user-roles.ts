import type { MigrationContext } from '../umzug.ts';

export async function up({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query(`
    CREATE TABLE user_roles (
      user_id    BIGINT UNSIGNED NOT NULL,
      role_id    BIGINT UNSIGNED NOT NULL,
      granted_by BIGINT UNSIGNED NULL,
      granted_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (user_id, role_id),
      KEY idx_ur_role (role_id),
      CONSTRAINT fk_ur_user    FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_ur_role    FOREIGN KEY (role_id)    REFERENCES roles(id),
      CONSTRAINT fk_ur_granter FOREIGN KEY (granted_by) REFERENCES users(id)
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS user_roles');
}
