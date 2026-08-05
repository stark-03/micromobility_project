import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';

export type ActorType = 'user' | 'api_key' | 'system';

export class AuditLog extends Model<InferAttributes<AuditLog>, InferCreationAttributes<AuditLog>> {
  declare id: CreationOptional<string>;
  declare actor_type: ActorType;
  declare actor_id: CreationOptional<string | null>;
  declare action: string;
  declare subject_type: CreationOptional<string | null>;
  declare subject_id: CreationOptional<string | null>;
  declare metadata: CreationOptional<Record<string, unknown> | null>;
  declare ip: CreationOptional<Buffer | null>;
  declare created_at: CreationOptional<Date>;
}

export function initAuditLog(sequelize: Sequelize): typeof AuditLog {
  AuditLog.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      actor_type: {
        type: DataTypes.ENUM('user', 'api_key', 'system'),
        allowNull: false,
      },
      actor_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      action: { type: DataTypes.STRING(64), allowNull: false },
      subject_type: { type: DataTypes.STRING(64), allowNull: true },
      subject_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      metadata: { type: DataTypes.JSON, allowNull: true },
      ip: { type: DataTypes.BLOB, allowNull: true },
      created_at: DataTypes.DATE(3),
    },
    // Append-only: an audit row is never updated.
    { sequelize, tableName: 'audit_logs', underscored: true, updatedAt: false },
  );
  return AuditLog;
}
