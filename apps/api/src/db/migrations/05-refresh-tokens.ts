import type { MigrationContext } from '../umzug.ts';

export async function up({ sequelize }: MigrationContext): Promise<void> {
  // Only the SHA-256 hash is stored; the raw token exists solely in the cookie.
  // family_id groups a rotation chain: presenting a token whose used_at is
  // already set revokes the whole family (design.md §7 reuse detection).
  await sequelize.query(`
    CREATE TABLE refresh_tokens (
      id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id        BIGINT UNSIGNED NOT NULL,
      family_id      CHAR(36)      NOT NULL,
      token_hash     CHAR(64)      NOT NULL,
      issued_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      expires_at     DATETIME(3)   NOT NULL,
      used_at        DATETIME(3)   NULL,
      revoked_at     DATETIME(3)   NULL,
      revoked_reason ENUM('rotated','logout','reuse_detected','expired') NULL,
      replaced_by_id BIGINT UNSIGNED NULL,
      user_agent     VARCHAR(255)  NULL,
      ip             VARBINARY(16) NULL,
      created_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_rt_hash (token_hash),
      KEY idx_rt_user (user_id),
      KEY idx_rt_family (family_id),
      KEY idx_rt_expires (expires_at),
      CONSTRAINT fk_rt_user     FOREIGN KEY (user_id)        REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_rt_replaced FOREIGN KEY (replaced_by_id) REFERENCES refresh_tokens(id)
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS refresh_tokens');
}
