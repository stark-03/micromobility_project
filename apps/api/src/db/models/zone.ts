import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';

/**
 * `boundary POLYGON NOT NULL` and `centroid POINT NOT NULL` are deliberately
 * absent — see saved-place.ts for the reasoning. Zones are inserted by the
 * seeder with raw SQL and polygonLiteral()/pointLiteral().
 */
export class Zone extends Model<InferAttributes<Zone>, InferCreationAttributes<Zone>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare code: string;
  /** DECIMAL — mysql2 returns it as a string. Convert in the DTO mapper. */
  declare population_ix: CreationOptional<string | null>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initZone(sequelize: Sequelize): typeof Zone {
  Zone.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      name: { type: DataTypes.STRING(120), allowNull: false },
      code: { type: DataTypes.STRING(32), allowNull: false, unique: true },
      population_ix: { type: DataTypes.DECIMAL(6, 3), allowNull: true },
      created_at: DataTypes.DATE(3),
      updated_at: DataTypes.DATE(3),
    },
    { sequelize, tableName: 'zones', underscored: true },
  );
  return Zone;
}
