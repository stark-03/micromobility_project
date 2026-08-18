import type { MigrationContext } from '../umzug.ts';

/**
 * M07 — fleet optimisation.
 *
 * A plan is a decision that was made at a moment, so the inputs it was made
 * from are stored beside it. `zone_supply_snapshots` is not redundant with
 * live vehicle counts: six hours later the counts have moved on, and without
 * the snapshot nobody can say whether a plan was wrong or merely stale.
 */
export async function up({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query(`
    CREATE TABLE rebalance_plans (
      id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      status            ENUM('planned','no_action','in_progress','completed','cancelled')
                        NOT NULL DEFAULT 'planned',
      horizon_hours     DECIMAL(5,2)  NOT NULL DEFAULT 2.00,
      van_count         SMALLINT UNSIGNED NOT NULL,
      van_capacity      SMALLINT UNSIGNED NOT NULL,
      /** The operator's dial, in km of driving one placed vehicle is worth. */
      value_per_vehicle_km DECIMAL(6,2) NOT NULL DEFAULT 6.00,
      total_vehicles    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      total_distance_km DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      deficit_before    DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      deficit_after     DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      /** Solver commentary — e.g. "van capacity is the binding constraint". */
      notes             JSON          NULL,
      created_by        BIGINT UNSIGNED NOT NULL,
      created_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_plans_created (created_at),
      CONSTRAINT fk_plans_user FOREIGN KEY (created_by) REFERENCES users(id)
    ) ENGINE=InnoDB
  `);

  await sequelize.query(`
    CREATE TABLE rebalance_tasks (
      id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      plan_id      BIGINT UNSIGNED NOT NULL,
      /** Execution order. The solver emits longest haul first, so a shift cut
          short leaves the least justifiable moves undone. */
      sequence     SMALLINT UNSIGNED NOT NULL,
      from_zone_id BIGINT UNSIGNED NOT NULL,
      to_zone_id   BIGINT UNSIGNED NOT NULL,
      vehicles     SMALLINT UNSIGNED NOT NULL,
      distance_km  DECIMAL(8,3)   NOT NULL,
      status       ENUM('pending','in_progress','done','skipped') NOT NULL DEFAULT 'pending',
      assigned_to  BIGINT UNSIGNED NULL,
      completed_at DATETIME(3)    NULL,
      created_at   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_tasks_plan (plan_id, sequence),
      KEY idx_tasks_status (status),
      CONSTRAINT fk_tasks_plan FOREIGN KEY (plan_id) REFERENCES rebalance_plans(id) ON DELETE CASCADE,
      CONSTRAINT fk_tasks_from FOREIGN KEY (from_zone_id) REFERENCES zones(id),
      CONSTRAINT fk_tasks_to   FOREIGN KEY (to_zone_id)   REFERENCES zones(id),
      CONSTRAINT fk_tasks_user FOREIGN KEY (assigned_to)  REFERENCES users(id)
    ) ENGINE=InnoDB
  `);

  await sequelize.query(`
    CREATE TABLE zone_supply_snapshots (
      id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      plan_id         BIGINT UNSIGNED NULL,
      zone_id         BIGINT UNSIGNED NOT NULL,
      captured_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      supply          SMALLINT UNSIGNED NOT NULL,
      forecast_demand DECIMAL(10,3) NOT NULL,
      /** supply - forecast_demand. Stored because it is what the plan acted on. */
      gap             DECIMAL(10,3) NOT NULL,
      KEY idx_snapshots_zone_time (zone_id, captured_at),
      CONSTRAINT fk_snap_plan FOREIGN KEY (plan_id) REFERENCES rebalance_plans(id) ON DELETE CASCADE,
      CONSTRAINT fk_snap_zone FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await sequelize.query(`
    CREATE TABLE charging_tasks (
      id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      vehicle_id   BIGINT UNSIGNED NOT NULL,
      zone_id      BIGINT UNSIGNED NULL,
      battery_pct  DECIMAL(5,2)  NOT NULL,
      /** Urgency scaled by how much the zone can spare the vehicle. */
      priority     DECIMAL(8,4)  NOT NULL,
      status       ENUM('pending','in_progress','done','skipped') NOT NULL DEFAULT 'pending',
      assigned_to  BIGINT UNSIGNED NULL,
      completed_at DATETIME(3)   NULL,
      created_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_charging_status (status, priority),
      CONSTRAINT fk_charge_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
      CONSTRAINT fk_charge_zone    FOREIGN KEY (zone_id)    REFERENCES zones(id),
      CONSTRAINT fk_charge_user    FOREIGN KEY (assigned_to) REFERENCES users(id)
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('DROP TABLE IF EXISTS charging_tasks');
  await sequelize.query('DROP TABLE IF EXISTS zone_supply_snapshots');
  await sequelize.query('DROP TABLE IF EXISTS rebalance_tasks');
  await sequelize.query('DROP TABLE IF EXISTS rebalance_plans');
}
