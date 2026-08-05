import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';

/**
 * `position POINT NOT NULL SRID 4326` is deliberately absent from this model.
 * Omitting it means Sequelize never SELECTs or INSERTs it, which makes it
 * structurally impossible to read a coordinate without going through
 * db/spatial.ts and its axis-order handling.
 *
 * Because the column is NOT NULL, rows cannot be created through this model —
 * the service layer inserts with a raw query and pointLiteral().
 */
export class SavedPlace extends Model<
  InferAttributes<SavedPlace>,
  InferCreationAttributes<SavedPlace>
> {
  declare id: CreationOptional<string>;
  declare user_id: string;
  declare label: string;
  declare address: CreationOptional<string | null>;
  declare kind: CreationOptional<'home' | 'work' | 'other'>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initSavedPlace(sequelize: Sequelize): typeof SavedPlace {
  SavedPlace.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      label: { type: DataTypes.STRING(80), allowNull: false },
      address: { type: DataTypes.STRING(255), allowNull: true },
      kind: {
        type: DataTypes.ENUM('home', 'work', 'other'),
        allowNull: false,
        defaultValue: 'other',
      },
      created_at: DataTypes.DATE(3),
      updated_at: DataTypes.DATE(3),
    },
    { sequelize, tableName: 'saved_places', underscored: true },
  );
  return SavedPlace;
}
