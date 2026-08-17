import { DataTypes, Model } from 'sequelize';
import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  Sequelize,
} from 'sequelize';

/**
 * M06. One scalar result of one run.
 *
 * Narrow by design — see migration 23. A new metric is a row, not a migration.
 */
export class SimulationMetric extends Model<
  InferAttributes<SimulationMetric>,
  InferCreationAttributes<SimulationMetric>
> {
  declare id: CreationOptional<string>;
  declare run_id: string;
  declare metric_key: string;
  /** DECIMAL comes back as a string; the DTO layer is where it becomes a number. */
  declare metric_value: string;
  declare created_at: CreationOptional<Date>;
}

export function initSimulationMetric(sequelize: Sequelize): typeof SimulationMetric {
  SimulationMetric.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      run_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      metric_key: { type: DataTypes.STRING(64), allowNull: false },
      metric_value: { type: DataTypes.DECIMAL(18, 4), allowNull: false },
      created_at: DataTypes.DATE(3),
    },
    { sequelize, tableName: 'simulation_metrics', underscored: true, timestamps: false },
  );
  return SimulationMetric;
}
