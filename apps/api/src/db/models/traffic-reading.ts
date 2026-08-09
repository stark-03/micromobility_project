import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';

/**
 * Partitioned by month on observed_at. Same constraints as vehicle_telemetry:
 * no FK, no SPATIAL index, no GEOMETRY column — the geometry lives on
 * road_segments and is joined at read time.
 *
 * Never query this table un-bounded by time.
 */
export class TrafficReading extends Model<
  InferAttributes<TrafficReading>,
  InferCreationAttributes<TrafficReading>
> {
  declare id: CreationOptional<string>;
  declare segment_id: string;
  declare observed_at: Date;
  /** DECIMAL — arrives as a string. */
  declare mean_speed_kph: CreationOptional<string | null>;
  declare vehicle_count: CreationOptional<number | null>;
  /** DECIMAL — arrives as a string. */
  declare occupancy: CreationOptional<string | null>;
  declare source: 'gps' | 'sensor' | 'camera' | 'synthetic';
}

export function initTrafficReading(sequelize: Sequelize): typeof TrafficReading {
  TrafficReading.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      segment_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      observed_at: { type: DataTypes.DATE(3), allowNull: false, primaryKey: true },
      mean_speed_kph: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
      vehicle_count: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true },
      occupancy: { type: DataTypes.DECIMAL(5, 4), allowNull: true },
      source: {
        type: DataTypes.ENUM('gps', 'sensor', 'camera', 'synthetic'),
        allowNull: false,
      },
    },
    { sequelize, tableName: 'traffic_readings', underscored: true, timestamps: false },
  );
  return TrafficReading;
}
