import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';

export class Operator extends Model<InferAttributes<Operator>, InferCreationAttributes<Operator>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare code: string;
  declare contact_email: string | null;
  declare contact_phone: string | null;
  declare status: CreationOptional<'active' | 'inactive'>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initOperator(sequelize: Sequelize): typeof Operator {
  Operator.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      code: { type: DataTypes.STRING(32), allowNull: false, unique: true },
      contact_email: { type: DataTypes.STRING(255), allowNull: true },
      contact_phone: { type: DataTypes.STRING(32), allowNull: true },
      status: {
        type: DataTypes.ENUM('active', 'inactive'),
        allowNull: false,
        defaultValue: 'active',
      },
      created_at: DataTypes.DATE(3),
      updated_at: DataTypes.DATE(3),
    },
    { sequelize, tableName: 'operators', underscored: true },
  );
  return Operator;
}
