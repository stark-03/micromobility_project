import type { MigrationContext } from '../umzug.ts';

export async function up({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query(`
    CREATE TABLE maintenance_tickets (
      id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      vehicle_id  BIGINT UNSIGNED NOT NULL,
      operator_id BIGINT UNSIGNED NOT NULL,
      reported_by BIGINT UNSIGNED NULL,
      assigned_to BIGINT UNSIGNED NULL,
      source      ENUM('manual','telemetry','inspection') NOT NULL DEFAULT 'manual',
      severity    ENUM('low','medium','high','critical')  NOT NULL DEFAULT 'medium',
      status      ENUM('open','in_progress','resolved','cancelled') NOT NULL DEFAULT 'open',
      title       VARCHAR(160) NOT NULL,
      description TEXT         NULL,
      fault_code  VARCHAR(32)  NULL,
      opened_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      resolved_at DATETIME(3)  NULL,
      created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_mt_vehicle_status (vehicle_id, status),
      KEY idx_mt_status_severity (status, severity),
      KEY idx_mt_operator (operator_id),
      CONSTRAINT fk_mt_vehicle  FOREIGN KEY (vehicle_id)  REFERENCES vehicles(id) ON DELETE CASCADE,
      CONSTRAINT fk_mt_operator FOREIGN KEY (operator_id) REFERENCES operators(id),
      CONSTRAINT fk_mt_reporter FOREIGN KEY (reported_by) REFERENCES users(id),
      CONSTRAINT fk_mt_assignee FOREIGN KEY (assigned_to) REFERENCES users(id)
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS maintenance_tickets');
}
