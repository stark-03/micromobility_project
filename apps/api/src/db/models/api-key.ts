import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';

export class ApiKey extends Model<InferAttributes<ApiKey>, InferCreationAttributes<ApiKey>> {
  declare id: CreationOptional<string>;
  declare name: string;
  /** Indexed lookup handle. The full key is shown exactly once, at creation. */
  declare key_prefix: string;
  declare key_hash: string;
  declare scopes: string[];
  declare operator_id: CreationOptional<string | null>;
  declare created_by: string;
  declare last_used_at: CreationOptional<Date | null>;
  declare expires_at: CreationOptional<Date | null>;
  declare revoked_at: CreationOptional<Date | null>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initApiKey(sequelize: Sequelize): typeof ApiKey {
  ApiKey.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      key_prefix: { type: DataTypes.CHAR(8), allowNull: false },
      key_hash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
      scopes: { type: DataTypes.JSON, allowNull: false },
      operator_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      created_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      last_used_at: { type: DataTypes.DATE(3), allowNull: true },
      expires_at: { type: DataTypes.DATE(3), allowNull: true },
      revoked_at: { type: DataTypes.DATE(3), allowNull: true },
      created_at: DataTypes.DATE(3),
      updated_at: DataTypes.DATE(3),
    },
    { sequelize, tableName: 'api_keys', underscored: true },
  );
  return ApiKey;
}
