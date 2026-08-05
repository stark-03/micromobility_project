import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';
import type { RoadClass } from '@mm/shared-types';

/**
 * `geometry LINESTRING NOT NULL` is deliberately absent — see saved-place.ts.
 * from_node/to_node are graph vertex labels, not FKs; Sprint 3's A* builds its
 * adjacency from them.
 */
export class RoadSegment extends Model<
  InferAttributes<RoadSegment>,
  InferCreationAttributes<RoadSegment>
> {
  declare id: CreationOptional<string>;
  declare zone_id: CreationOptional<string | null>;
  declare name: CreationOptional<string | null>;
  declare external_ref: CreationOptional<string | null>;
  declare from_node: string;
  declare to_node: string;
  /** DECIMAL — arrives as a string. */
  declare length_m: string;
  /** DECIMAL — arrives as a string. */
  declare speed_free_kph: string;
  declare lanes: CreationOptional<number>;
  declare one_way: CreationOptional<boolean>;
  /** DECIMAL — arrives as a string. */
  declare gradient_pct: CreationOptional<string>;
  declare road_class: RoadClass;
  declare has_bike_lane: CreationOptional<boolean>;
  declare lit: CreationOptional<boolean>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initRoadSegment(sequelize: Sequelize): typeof RoadSegment {
  RoadSegment.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      zone_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      name: { type: DataTypes.STRING(160), allowNull: true },
      external_ref: { type: DataTypes.STRING(64), allowNull: true, unique: true },
      from_node: { type: DataTypes.STRING(32), allowNull: false },
      to_node: { type: DataTypes.STRING(32), allowNull: false },
      length_m: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      speed_free_kph: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
      lanes: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 1 },
      one_way: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      gradient_pct: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: '0.00' },
      road_class: {
        type: DataTypes.ENUM('arterial', 'collector', 'local', 'path', 'cycleway'),
        allowNull: false,
      },
      has_bike_lane: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      lit: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: DataTypes.DATE(3),
      updated_at: DataTypes.DATE(3),
    },
    { sequelize, tableName: 'road_segments', underscored: true },
  );
  return RoadSegment;
}
