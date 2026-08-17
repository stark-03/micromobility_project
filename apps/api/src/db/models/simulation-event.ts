import { DataTypes, Model } from 'sequelize';
import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  Sequelize,
} from 'sequelize';

/** M06. One bucket of a run's timeline — exactly what the chart draws. */
export class SimulationEvent extends Model<
  InferAttributes<SimulationEvent>,
  InferCreationAttributes<SimulationEvent>
> {
  declare id: CreationOptional<string>;
  declare run_id: string;
  declare bucket: number;
  declare sim_minutes: number;
  declare trips_served: CreationOptional<number>;
  declare trips_unserved: CreationOptional<number>;
  declare mean_wait_seconds: CreationOptional<string>;
  declare safety_incidents: CreationOptional<string>;
  declare created_at: CreationOptional<Date>;
}

export function initSimulationEvent(sequelize: Sequelize): typeof SimulationEvent {
  SimulationEvent.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      run_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      bucket: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false },
      sim_minutes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      trips_served: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      trips_unserved: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      mean_wait_seconds: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: '0.00',
      },
      safety_incidents: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: false,
        defaultValue: '0.0000',
      },
      created_at: DataTypes.DATE(3),
    },
    { sequelize, tableName: 'simulation_events', underscored: true, timestamps: false },
  );
  return SimulationEvent;
}
