import { DataTypes, Model } from 'sequelize';
import type {
  CreationOptional,
  InferAttributes,
  InferCreationAttributes,
  Sequelize,
} from 'sequelize';

/** M06. A named what-if: the levers, not the results. */
export class Scenario extends Model<
  InferAttributes<Scenario>,
  InferCreationAttributes<Scenario>
> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare description: CreationOptional<string | null>;
  declare sim_hours: CreationOptional<string>;
  declare start_hour: CreationOptional<string>;
  declare fleet: { scooter: number; ebike: number; bike: number };
  declare weather: { precipitationMm: number; tempC: number };
  declare policy: Record<string, unknown>;
  declare demand: CreationOptional<Record<string, number[]> | null>;
  declare baseline_run_id: CreationOptional<string | null>;
  declare created_by: string;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
  declare deleted_at: CreationOptional<Date | null>;
}

export function initScenario(sequelize: Sequelize): typeof Scenario {
  Scenario.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      sim_hours: { type: DataTypes.DECIMAL(6, 2), allowNull: false, defaultValue: '24.00' },
      start_hour: { type: DataTypes.DECIMAL(4, 2), allowNull: false, defaultValue: '0.00' },
      fleet: { type: DataTypes.JSON, allowNull: false },
      weather: { type: DataTypes.JSON, allowNull: false },
      policy: { type: DataTypes.JSON, allowNull: false },
      demand: { type: DataTypes.JSON, allowNull: true },
      baseline_run_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      created_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      created_at: DataTypes.DATE(3),
      updated_at: DataTypes.DATE(3),
      deleted_at: DataTypes.DATE(3),
    },
    {
      sequelize,
      tableName: 'scenarios',
      underscored: true,
      paranoid: true,
      deletedAt: 'deleted_at',
    },
  );
  return Scenario;
}
