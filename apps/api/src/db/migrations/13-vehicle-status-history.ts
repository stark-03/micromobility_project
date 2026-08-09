import type { MigrationContext } from '../umzug.ts';

export async function up({ sequelize }: MigrationContext): Promise<void> {
  // from_status is NULL only for the row written when a vehicle is registered.
  // Every accepted transition writes exactly one row, in the same transaction
  // as the vehicles.status update.
  await sequelize.query(`
    CREATE TABLE vehicle_status_history (
      id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      vehicle_id  BIGINT UNSIGNED NOT NULL,
      from_status ENUM('available','reserved','in_use','returning',
                       'charging','maintenance','retired') NULL,
      to_status   ENUM('available','reserved','in_use','returning',
                       'charging','maintenance','retired') NOT NULL,
      reason      VARCHAR(160)    NULL,
      changed_by  BIGINT UNSIGNED NULL,
      changed_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY idx_vsh_vehicle_time (vehicle_id, changed_at),
      CONSTRAINT fk_vsh_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
      CONSTRAINT fk_vsh_user    FOREIGN KEY (changed_by) REFERENCES users(id)
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS vehicle_status_history');
}
