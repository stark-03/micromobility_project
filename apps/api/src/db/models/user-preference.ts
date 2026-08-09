import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';
import type { VehicleType } from '@mm/shared-types';

export class UserPreference extends Model<
  InferAttributes<UserPreference>,
  InferCreationAttributes<UserPreference>
> {
  declare user_id: string;
  declare language: CreationOptional<string>;
  declare units: CreationOptional<'metric' | 'imperial'>;
  declare preferred_vehicle_type: CreationOptional<VehicleType | null>;
  declare theme: CreationOptional<'dark' | 'light'>;
  declare notifications_enabled: CreationOptional<boolean>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initUserPreference(sequelize: Sequelize): typeof UserPreference {
  UserPreference.init(
    {
      user_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true },
      language: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'en' },
      units: {
        type: DataTypes.ENUM('metric', 'imperial'),
        allowNull: false,
        defaultValue: 'metric',
      },
      preferred_vehicle_type: {
        type: DataTypes.ENUM('scooter', 'bike', 'ebike', 'ev'),
        allowNull: true,
      },
      theme: { type: DataTypes.ENUM('dark', 'light'), allowNull: false, defaultValue: 'dark' },
      notifications_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_at: DataTypes.DATE(3),
      updated_at: DataTypes.DATE(3),
    },
    { sequelize, tableName: 'user_preferences', underscored: true },
  );
  return UserPreference;
}
