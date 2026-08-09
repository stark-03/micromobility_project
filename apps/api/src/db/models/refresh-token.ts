import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';

export type RevokedReason = 'rotated' | 'logout' | 'reuse_detected' | 'expired';

export class RefreshToken extends Model<
  InferAttributes<RefreshToken>,
  InferCreationAttributes<RefreshToken>
> {
  declare id: CreationOptional<string>;
  declare user_id: string;
  declare family_id: string;
  /** SHA-256 hex of the raw token. The raw value exists only in the cookie. */
  declare token_hash: string;
  declare issued_at: CreationOptional<Date>;
  declare expires_at: Date;
  declare used_at: CreationOptional<Date | null>;
  declare revoked_at: CreationOptional<Date | null>;
  declare revoked_reason: CreationOptional<RevokedReason | null>;
  declare replaced_by_id: CreationOptional<string | null>;
  declare user_agent: CreationOptional<string | null>;
  declare ip: CreationOptional<Buffer | null>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initRefreshToken(sequelize: Sequelize): typeof RefreshToken {
  RefreshToken.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      family_id: { type: DataTypes.CHAR(36), allowNull: false },
      token_hash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
      issued_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: DataTypes.NOW },
      expires_at: { type: DataTypes.DATE(3), allowNull: false },
      used_at: { type: DataTypes.DATE(3), allowNull: true },
      revoked_at: { type: DataTypes.DATE(3), allowNull: true },
      revoked_reason: {
        type: DataTypes.ENUM('rotated', 'logout', 'reuse_detected', 'expired'),
        allowNull: true,
      },
      replaced_by_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      user_agent: { type: DataTypes.STRING(255), allowNull: true },
      ip: { type: DataTypes.BLOB, allowNull: true },
      created_at: DataTypes.DATE(3),
      updated_at: DataTypes.DATE(3),
    },
    { sequelize, tableName: 'refresh_tokens', underscored: true },
  );
  return RefreshToken;
}
