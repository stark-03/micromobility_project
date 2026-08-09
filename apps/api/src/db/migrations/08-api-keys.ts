import type { MigrationContext } from '../umzug.ts';

export async function up({ sequelize }: MigrationContext): Promise<void> {
  // Device identities for IoT gateways — no password, scoped keys.
  // key_prefix is the indexed lookup handle; key_hash is the SHA-256 of the
  // full secret. The raw key is shown exactly once, at creation.
  await sequelize.query(`
    CREATE TABLE api_keys (
      id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name         VARCHAR(120) NOT NULL,
      key_prefix   CHAR(8)      NOT NULL,
      key_hash     CHAR(64)     NOT NULL,
      scopes       JSON         NOT NULL,
      operator_id  BIGINT UNSIGNED NULL,
      created_by   BIGINT UNSIGNED NOT NULL,
      last_used_at DATETIME(3)  NULL,
      expires_at   DATETIME(3)  NULL,
      revoked_at   DATETIME(3)  NULL,
      created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_ak_hash (key_hash),
      KEY idx_ak_prefix (key_prefix),
      CONSTRAINT fk_ak_operator FOREIGN KEY (operator_id) REFERENCES operators(id),
      CONSTRAINT fk_ak_creator  FOREIGN KEY (created_by)  REFERENCES users(id)
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS api_keys');
}
