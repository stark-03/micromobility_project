import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';

/**
 * Partitioned by month on recorded_at. MySQL forbids foreign keys, SPATIAL
 * indexes AND GEOMETRY columns on partitioned tables, so:
 *   - there is no association to Vehicle (see models/index.ts)
 *   - position is lat/lng DECIMAL rather than a POINT; the DTO mapper rebuilds
 *     a GeoPoint from them
 *
 * Never query this table un-bounded by time.
 */
export class VehicleTelemetry extends Model<
  InferAttributes<VehicleTelemetry>,
  InferCreationAttributes<VehicleTelemetry>
> {
  declare id: CreationOptional<string>;
  declare vehicle_id: string;
  declare recorded_at: Date;
  /** DECIMAL — arrives as a string. */
  declare lat: CreationOptional<string | null>;
  /** DECIMAL — arrives as a string. */
  declare lng: CreationOptional<string | null>;
  /** DECIMAL — arrives as a string. */
  declare speed_kph: CreationOptional<string | null>;
  declare battery_pct: CreationOptional<number | null>;
  declare odometer_m: CreationOptional<string | null>;
  declare lock_state: CreationOptional<'locked' | 'unlocked' | null>;
  declare fault_code: CreationOptional<string | null>;
  declare source: CreationOptional<'gps' | 'sensor' | 'synthetic'>;
}

export function initVehicleTelemetry(sequelize: Sequelize): typeof VehicleTelemetry {
  VehicleTelemetry.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      vehicle_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      // Part of the composite primary key (id, recorded_at) required by partitioning.
      recorded_at: { type: DataTypes.DATE(3), allowNull: false, primaryKey: true },
      lat: { type: DataTypes.DECIMAL(9, 6), allowNull: true },
      lng: { type: DataTypes.DECIMAL(10, 6), allowNull: true },
      speed_kph: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      battery_pct: { type: DataTypes.TINYINT.UNSIGNED, allowNull: true },
      odometer_m: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      lock_state: { type: DataTypes.ENUM('locked', 'unlocked'), allowNull: true },
      fault_code: { type: DataTypes.STRING(32), allowNull: true },
      source: {
        type: DataTypes.ENUM('gps', 'sensor', 'synthetic'),
        allowNull: false,
        defaultValue: 'gps',
      },
    },
    // No created_at/updated_at — recorded_at is the only time this table cares about.
    { sequelize, tableName: 'vehicle_telemetry', underscored: true, timestamps: false },
  );
  return VehicleTelemetry;
}
