import type { MigrationContext } from '../umzug.ts';

// Precedes `users` because users.operator_id references it.
export async function up({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query(`
    CREATE TABLE operators (
      id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name          VARCHAR(120) NOT NULL,
      code          VARCHAR(32)  NOT NULL,
      contact_email VARCHAR(255) NULL,
      contact_phone VARCHAR(32)  NULL,
      status        ENUM('active','inactive') NOT NULL DEFAULT 'active',
      created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_operators_code (code)
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS operators');
}
