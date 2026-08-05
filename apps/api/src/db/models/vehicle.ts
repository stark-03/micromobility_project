import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';
import type { VehicleStatus, VehicleType } from '@mm/shared-types';

/**
 * `last_position POINT NULL` is deliberately absent — see saved-place.ts.
 * It is nullable, so rows CAN be created through this model; the service sets
 * the position afterwards with a raw UPDATE and pointLiteral().
 */
export class Vehicle extends Model<InferAttributes<Vehicle>, InferCreationAttributes<Vehicle>> {
  declare id: CreationOptional<string>;
  declare operator_id: string;
  declare home_zone_id: CreationOptional<string | null>;
  declare external_ref: string;
  declare type: VehicleType;
  declare status: CreationOptional<VehicleStatus>;
  declare battery_pct: CreationOptional<number | null>;
  declare last_seen_at: CreationOptional<Date | null>;
  declare deleted_at: CreationOptional<Date | null>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initVehicle(sequelize: Sequelize): typeof Vehicle {
  Vehicle.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      operator_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      home_zone_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      external_ref: { type: DataTypes.STRING(64), allowNull: false },
      type: { type: DataTypes.ENUM('scooter', 'bike', 'ebike', 'ev'), allowNull: false },
      status: {
        type: DataTypes.ENUM(
          'available',
          'reserved',
          'in_use',
          'returning',
          'charging',
          'maintenance',
          'retired',
        ),
        allowNull: false,
        defaultValue: 'available',
      },
      battery_pct: { type: DataTypes.TINYINT.UNSIGNED, allowNull: true },
      last_seen_at: { type: DataTypes.DATE(3), allowNull: true },
      deleted_at: { type: DataTypes.DATE(3), allowNull: true },
      created_at: DataTypes.DATE(3),
      updated_at: DataTypes.DATE(3),
    },
    {
      sequelize,
      tableName: 'vehicles',
      underscored: true,
      paranoid: true,
      deletedAt: 'deleted_at',
    },
  );
  return Vehicle;
}
