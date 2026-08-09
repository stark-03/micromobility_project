import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';
import type { UserStatus } from '@mm/shared-types';

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<string>;
  declare operator_id: CreationOptional<string | null>;
  declare email: string;
  declare password_hash: string;
  declare full_name: string;
  declare phone: CreationOptional<string | null>;
  declare status: CreationOptional<UserStatus>;
  declare last_login_at: CreationOptional<Date | null>;
  declare deleted_at: CreationOptional<Date | null>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initUser(sequelize: Sequelize): typeof User {
  User.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      operator_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      password_hash: { type: DataTypes.STRING(255), allowNull: false },
      full_name: { type: DataTypes.STRING(120), allowNull: false },
      phone: { type: DataTypes.STRING(32), allowNull: true },
      status: {
        type: DataTypes.ENUM('active', 'suspended', 'pending'),
        allowNull: false,
        defaultValue: 'active',
      },
      last_login_at: { type: DataTypes.DATE(3), allowNull: true },
      deleted_at: { type: DataTypes.DATE(3), allowNull: true },
      created_at: DataTypes.DATE(3),
      updated_at: DataTypes.DATE(3),
    },
    {
      sequelize,
      tableName: 'users',
      underscored: true,
      paranoid: true,
      deletedAt: 'deleted_at',
    },
  );
  return User;
}
