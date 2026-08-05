import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';

export class UserRole extends Model<InferAttributes<UserRole>, InferCreationAttributes<UserRole>> {
  declare user_id: string;
  declare role_id: string;
  declare granted_by: CreationOptional<string | null>;
  declare granted_at: CreationOptional<Date>;
}

export function initUserRole(sequelize: Sequelize): typeof UserRole {
  UserRole.init(
    {
      user_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true },
      role_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true },
      granted_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      granted_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: DataTypes.NOW },
    },
    // No created_at/updated_at on this table — granted_at carries the timestamp.
    { sequelize, tableName: 'user_roles', underscored: true, timestamps: false },
  );
  return UserRole;
}
