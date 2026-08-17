import { DataTypes, Model } from 'sequelize';
import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  Sequelize,
} from 'sequelize';

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed';

/** M06. One execution of a scenario at one seed. Immutable once completed. */
export class SimulationRun extends Model<
  InferAttributes<SimulationRun>,
  InferCreationAttributes<SimulationRun>
> {
  declare id: CreationOptional<string>;
  declare scenario_id: string;
  declare seed: number;
  declare status: CreationOptional<RunStatus>;
  declare progress: CreationOptional<string>;
  declare started_at: CreationOptional<Date | null>;
  declare finished_at: CreationOptional<Date | null>;
  declare duration_ms: CreationOptional<number | null>;
  declare model_version: CreationOptional<string | null>;
  declare detail: CreationOptional<Record<string, unknown> | null>;
  declare error: CreationOptional<string | null>;
  declare created_by: string;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initSimulationRun(sequelize: Sequelize): typeof SimulationRun {
  SimulationRun.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      scenario_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      seed: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      status: {
        type: DataTypes.ENUM('queued', 'running', 'completed', 'failed'),
        allowNull: false,
        defaultValue: 'queued',
      },
      progress: { type: DataTypes.DECIMAL(5, 4), allowNull: false, defaultValue: '0.0000' },
      started_at: { type: DataTypes.DATE(3), allowNull: true },
      finished_at: { type: DataTypes.DATE(3), allowNull: true },
      duration_ms: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      model_version: { type: DataTypes.STRING(64), allowNull: true },
      detail: { type: DataTypes.JSON, allowNull: true },
      error: { type: DataTypes.TEXT, allowNull: true },
      created_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      created_at: DataTypes.DATE(3),
      updated_at: DataTypes.DATE(3),
    },
    { sequelize, tableName: 'simulation_runs', underscored: true },
  );
  return SimulationRun;
}
