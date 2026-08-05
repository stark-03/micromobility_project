import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';
import type { VehicleStatus } from '@mm/shared-types';

const STATUS_ENUM = [
  'available',
  'reserved',
  'in_use',
  'returning',
  'charging',
  'maintenance',
  'retired',
] as const;

export class VehicleStatusHistory extends Model<
  InferAttributes<VehicleStatusHistory>,
  InferCreationAttributes<VehicleStatusHistory>
> {
  declare id: CreationOptional<string>;
  declare vehicle_id: string;
  /** NULL only for the row written when a vehicle is registered. */
  declare from_status: VehicleStatus | null;
  declare to_status: VehicleStatus;
  declare reason: CreationOptional<string | null>;
  declare changed_by: CreationOptional<string | null>;
  declare changed_at: CreationOptional<Date>;
  declare created_at: CreationOptional<Date>;
}

export function initVehicleStatusHistory(sequelize: Sequelize): typeof VehicleStatusHistory {
  VehicleStatusHistory.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      vehicle_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      from_status: { type: DataTypes.ENUM(...STATUS_ENUM), allowNull: true },
      to_status: { type: DataTypes.ENUM(...STATUS_ENUM), allowNull: false },
      reason: { type: DataTypes.STRING(160), allowNull: true },
      changed_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      changed_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: DataTypes.NOW },
      created_at: DataTypes.DATE(3),
    },
    { sequelize, tableName: 'vehicle_status_history', underscored: true, updatedAt: false },
  );
  return VehicleStatusHistory;
}
