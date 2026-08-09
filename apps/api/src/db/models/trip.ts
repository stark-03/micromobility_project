import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';

/**
 * `start_position` / `end_position` POINT columns are deliberately absent —
 * see saved-place.ts. Both are nullable, so rows can be created through this
 * model and positions set afterwards with pointLiteral().
 *
 * user_id is nullable because design.md §7 drops the user link from analytics.
 * public_ref is the pseudonymous handle downstream tables reference instead.
 */
export class Trip extends Model<InferAttributes<Trip>, InferCreationAttributes<Trip>> {
  declare id: CreationOptional<string>;
  declare public_ref: string;
  declare user_id: CreationOptional<string | null>;
  declare vehicle_id: string;
  declare operator_id: string;
  declare start_zone_id: CreationOptional<string | null>;
  declare end_zone_id: CreationOptional<string | null>;
  declare started_at: Date;
  declare ended_at: CreationOptional<Date | null>;
  /** DECIMAL — arrives as a string. */
  declare distance_m: CreationOptional<string | null>;
  declare duration_s: CreationOptional<number | null>;
  declare status: CreationOptional<'active' | 'completed' | 'cancelled'>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initTrip(sequelize: Sequelize): typeof Trip {
  Trip.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      public_ref: { type: DataTypes.CHAR(36), allowNull: false, unique: true },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      vehicle_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      operator_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      start_zone_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      end_zone_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      started_at: { type: DataTypes.DATE(3), allowNull: false },
      ended_at: { type: DataTypes.DATE(3), allowNull: true },
      distance_m: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      duration_s: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      status: {
        type: DataTypes.ENUM('active', 'completed', 'cancelled'),
        allowNull: false,
        defaultValue: 'active',
      },
      created_at: DataTypes.DATE(3),
      updated_at: DataTypes.DATE(3),
    },
    { sequelize, tableName: 'trips', underscored: true },
  );
  return Trip;
}
