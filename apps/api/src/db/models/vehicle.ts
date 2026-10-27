import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';
import crypto from 'node:crypto';
import type { VehicleStatus, VehicleType } from '@mm/shared-types';

/** No 0/O or 1/I/L — a code read off a scratched sticker must not be ambiguous. */
export const UNLOCK_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Eight random characters: the code printed on a vehicle as its QR code. */
export function newUnlockCode(): string {
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (const b of bytes) code += UNLOCK_ALPHABET[b % UNLOCK_ALPHABET.length];
  return code;
}

/**
 * `last_position POINT NULL` is deliberately absent — see saved-place.ts.
 * It is nullable, so rows CAN be created through this model; the service sets
 * the position afterwards with a raw UPDATE and pointLiteral().
 */
export class Vehicle extends Model<InferAttributes<Vehicle>, InferCreationAttributes<Vehicle>> {
  declare id: CreationOptional<string>;
  declare operator_id: string;
  declare home_zone_id: CreationOptional<string | null>;
  declare station_id: CreationOptional<string | null>;
  declare external_ref: string;
  declare unlock_code: CreationOptional<string | null>;
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
      station_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      external_ref: { type: DataTypes.STRING(64), allowNull: false },
      // Every vehicle gets a code at creation, so every vehicle can carry a QR.
      unlock_code: { type: DataTypes.CHAR(8), allowNull: true, defaultValue: newUnlockCode },
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
