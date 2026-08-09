import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';
import type { TicketSeverity, TicketStatus } from '@mm/shared-types';

export class MaintenanceTicket extends Model<
  InferAttributes<MaintenanceTicket>,
  InferCreationAttributes<MaintenanceTicket>
> {
  declare id: CreationOptional<string>;
  declare vehicle_id: string;
  declare operator_id: string;
  declare reported_by: CreationOptional<string | null>;
  declare assigned_to: CreationOptional<string | null>;
  declare source: CreationOptional<'manual' | 'telemetry' | 'inspection'>;
  declare severity: CreationOptional<TicketSeverity>;
  declare status: CreationOptional<TicketStatus>;
  declare title: string;
  declare description: CreationOptional<string | null>;
  declare fault_code: CreationOptional<string | null>;
  declare opened_at: CreationOptional<Date>;
  declare resolved_at: CreationOptional<Date | null>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initMaintenanceTicket(sequelize: Sequelize): typeof MaintenanceTicket {
  MaintenanceTicket.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      vehicle_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      operator_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      reported_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      assigned_to: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      source: {
        type: DataTypes.ENUM('manual', 'telemetry', 'inspection'),
        allowNull: false,
        defaultValue: 'manual',
      },
      severity: {
        type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
        allowNull: false,
        defaultValue: 'medium',
      },
      status: {
        type: DataTypes.ENUM('open', 'in_progress', 'resolved', 'cancelled'),
        allowNull: false,
        defaultValue: 'open',
      },
      title: { type: DataTypes.STRING(160), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      fault_code: { type: DataTypes.STRING(32), allowNull: true },
      opened_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: DataTypes.NOW },
      resolved_at: { type: DataTypes.DATE(3), allowNull: true },
      created_at: DataTypes.DATE(3),
      updated_at: DataTypes.DATE(3),
    },
    { sequelize, tableName: 'maintenance_tickets', underscored: true },
  );
  return MaintenanceTicket;
}
