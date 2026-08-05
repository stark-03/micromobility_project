import type { MigrationContext } from '../umzug.ts';

export async function up({ sequelize }: MigrationContext): Promise<void> {
  // No FK on actor_id: the actor may be a user, an API key, or the system.
  // Polymorphic subject for the same reason.
  await sequelize.query(`
    CREATE TABLE audit_logs (
      id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      actor_type   ENUM('user','api_key','system') NOT NULL,
      actor_id     BIGINT UNSIGNED NULL,
      action       VARCHAR(64)   NOT NULL,
      subject_type VARCHAR(64)   NULL,
      subject_id   BIGINT UNSIGNED NULL,
      metadata     JSON          NULL,
      ip           VARBINARY(16) NULL,
      created_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY idx_al_actor (actor_id, created_at),
      KEY idx_al_subject (subject_type, subject_id),
      KEY idx_al_action (action, created_at)
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS audit_logs');
}
