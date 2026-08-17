import type { MigrationContext } from '../umzug.ts';

/**
 * M06 — the simulation engine's tables.
 *
 * MODULES.md lists five: scenarios, simulation_runs, simulation_metrics,
 * simulation_events, scenario_comparisons. Four are created here.
 *
 * **scenario_comparisons is deliberately not created.** A comparison is a pure
 * function of two runs, and both are immutable once completed — so a stored
 * comparison can only ever agree with, or drift from, the runs it summarises.
 * It buys nothing: the join is two indexed primary-key lookups. `POST
 * /runs/compare` computes it live. If comparisons later need to be *named and
 * shared* (a planner circulating "Bike lanes vs baseline"), that is a different
 * table storing a title and two run ids, and it can be added then.
 */
export async function up({ sequelize }: MigrationContext): Promise<void> {
  // Scenarios carry deleted_at: CLAUDE.md lists them among the tables where
  // history matters. A run three months old must still name the scenario that
  // produced it, even after a planner tidies up their list.
  await sequelize.query(`
    CREATE TABLE scenarios (
      id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name          VARCHAR(120) NOT NULL,
      description   TEXT         NULL,
      sim_hours     DECIMAL(6,2) NOT NULL DEFAULT 24.00,
      /** Wall-clock hour the run starts at, so a short run can cover the peak. */
      start_hour    DECIMAL(4,2) NOT NULL DEFAULT 0.00,
      /** Vehicle counts by kind: {"scooter":180,"ebike":90,"bike":60}. */
      fleet         JSON         NOT NULL,
      /** {"precipitationMm":0,"tempC":27} */
      weather       JSON         NOT NULL,
      /** The policy levers. This column IS the what-if. */
      policy        JSON         NOT NULL,
      /** Optional explicit demand curves per zone; null = population-derived. */
      demand        JSON         NULL,
      /**
       * The run this scenario's results are read against. design.md §5: results
       * are shown as deltas, because the delta is what a planner acts on.
       */
      baseline_run_id BIGINT UNSIGNED NULL,
      created_by    BIGINT UNSIGNED NOT NULL,
      created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      deleted_at    DATETIME(3)  NULL,
      KEY idx_scenarios_live (deleted_at, created_at),
      CONSTRAINT fk_scenarios_user FOREIGN KEY (created_by) REFERENCES users(id)
    ) ENGINE=InnoDB
  `);

  // design.md §3.2 gives this table verbatim; progress and duration_ms are the
  // two additions, both needed by the run monitor the same document specifies.
  await sequelize.query(`
    CREATE TABLE simulation_runs (
      id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      scenario_id   BIGINT UNSIGNED   NOT NULL,
      seed          INT UNSIGNED      NOT NULL,
      status        ENUM('queued','running','completed','failed') NOT NULL DEFAULT 'queued',
      /** 0.0000–1.0000, written by the worker as the clock advances. */
      progress      DECIMAL(5,4)      NOT NULL DEFAULT 0.0000,
      started_at    DATETIME(3)       NULL,
      finished_at   DATETIME(3)       NULL,
      duration_ms   INT UNSIGNED      NULL,
      model_version VARCHAR(64)       NULL,
      /**
       * Non-scalar results — per-kind breakdowns and unserved reason codes.
       * Scalars live in simulation_metrics, which is what compare and reporting
       * read; nesting those in JSON would make every aggregate a JSON_EXTRACT.
       */
      detail        JSON              NULL,
      error         TEXT              NULL,
      created_by    BIGINT UNSIGNED   NOT NULL,
      created_at    DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at    DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      KEY idx_runs_scenario_status (scenario_id, status),
      KEY idx_runs_created (created_at),
      CONSTRAINT fk_runs_scenario FOREIGN KEY (scenario_id) REFERENCES scenarios(id),
      CONSTRAINT fk_runs_user     FOREIGN KEY (created_by)  REFERENCES users(id)
    ) ENGINE=InnoDB
  `);

  // Circular by nature — a scenario points at one of its own runs. Added after
  // both tables exist because neither can be created holding the other's key.
  await sequelize.query(`
    ALTER TABLE scenarios
      ADD CONSTRAINT fk_scenarios_baseline
      FOREIGN KEY (baseline_run_id) REFERENCES simulation_runs(id) ON DELETE SET NULL
  `);

  /**
   * Narrow (key, value) rather than one column per metric.
   *
   * The metric set is the part of M06 most likely to grow — M07 adds
   * rebalancing cost, M10 adds emissions splits — and each addition would
   * otherwise be a migration plus a model change plus a DTO change. Here it is
   * an extra row. Comparison and reporting both want to pivot over metrics
   * anyway, which a narrow table does naturally.
   */
  await sequelize.query(`
    CREATE TABLE simulation_metrics (
      id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      run_id       BIGINT UNSIGNED NOT NULL,
      metric_key   VARCHAR(64)     NOT NULL,
      /** Wide enough for kilometre and gram totals; never a float. */
      metric_value DECIMAL(18,4)   NOT NULL,
      created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_metric_run_key (run_id, metric_key),
      CONSTRAINT fk_metrics_run FOREIGN KEY (run_id) REFERENCES simulation_runs(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  /**
   * The run timeline, pre-bucketed by the engine.
   *
   * Storing one row per simulated trip would be tens of thousands of rows per
   * run to render a chart of at most a few dozen points. The engine buckets
   * before it returns, and this table holds exactly what the chart draws.
   */
  await sequelize.query(`
    CREATE TABLE simulation_events (
      id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      run_id            BIGINT UNSIGNED  NOT NULL,
      bucket            SMALLINT UNSIGNED NOT NULL,
      sim_minutes       INT UNSIGNED     NOT NULL,
      trips_served      INT UNSIGNED     NOT NULL DEFAULT 0,
      trips_unserved    INT UNSIGNED     NOT NULL DEFAULT 0,
      mean_wait_seconds DECIMAL(10,2)    NOT NULL DEFAULT 0.00,
      /** Expected incidents, not a count — see the ML engine's incident_risk(). */
      safety_incidents  DECIMAL(10,4)    NOT NULL DEFAULT 0.0000,
      created_at        DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_event_run_bucket (run_id, bucket),
      CONSTRAINT fk_events_run FOREIGN KEY (run_id) REFERENCES simulation_runs(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
}

export async function down({ sequelize }: MigrationContext): Promise<void> {
  await sequelize.query('ALTER TABLE scenarios DROP FOREIGN KEY fk_scenarios_baseline');
  await sequelize.query('DROP TABLE IF EXISTS simulation_events');
  await sequelize.query('DROP TABLE IF EXISTS simulation_metrics');
  await sequelize.query('DROP TABLE IF EXISTS simulation_runs');
  await sequelize.query('DROP TABLE IF EXISTS scenarios');
}
