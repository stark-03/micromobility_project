import type { MigrationContext } from '../umzug.ts';

export async function up({ sequelize }: MigrationContext): Promise<void> {
  // operator_id scopes operator-role users to one fleet. MODULES.md M01 does not
  // list it, but without it "operator" would mean "operator of everything".
  // Nullable: admins, planners, analysts and commuters have no operator.
  await sequelize.query(`
    CREATE TABLE users (
      id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      operator_id   BIGINT UNSIGNED NULL,
      email         VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      full_name     VARCHAR(120) NOT NULL,
      phone         VARCHAR(32)  NULL,
      status        ENUM('active','suspended','pending') NOT NULL DEFAULT 'active',
      last_login_at DATETIME(3)  NULL,
      deleted_at    DATETIME(3)  NULL,
      created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_users_email (email),
      KEY idx_users_operator (operator_id),
      KEY idx_users_status (status),
      CONSTRAINT fk_users_operator FOREIGN KEY (operator_id) REFERENCES operators(id)
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS users');
}
