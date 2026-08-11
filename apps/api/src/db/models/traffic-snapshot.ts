import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';

/** Exactly one row per segment, upserted by the snapshot worker. */
export class TrafficSnapshot extends Model<
  InferAttributes<TrafficSnapshot>,
  InferCreationAttributes<TrafficSnapshot>
> {
  declare id: CreationOptional<string>;
  declare segment_id: string;
  declare zone_id: CreationOptional<string | null>;
  declare computed_at: CreationOptional<Date>;
  declare mean_speed_kph: CreationOptional<string | null>;
  declare vehicle_count: CreationOptional<number | null>;
  declare occupancy: CreationOptional<string | null>;
  /** DECIMAL 0.000–1.000. Drives the --flow-* ramp on the map. */
  declare congestion_index: CreationOptional<string>;
  declare sample_count: CreationOptional<number>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initTrafficSnapshot(sequelize: Sequelize): typeof TrafficSnapshot {
  TrafficSnapshot.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      segment_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, unique: true },
      zone_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      computed_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: DataTypes.NOW },
      mean_speed_kph: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
      vehicle_count: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true },
      occupancy: { type: DataTypes.DECIMAL(5, 4), allowNull: true },
      congestion_index: { type: DataTypes.DECIMAL(4, 3), allowNull: false, defaultValue: '0.000' },
      sample_count: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      created_at: DataTypes.DATE(3),
      updated_at: DataTypes.DATE(3),
    },
    { sequelize, tableName: 'traffic_snapshots', underscored: true },
  );
  return TrafficSnapshot;
}
