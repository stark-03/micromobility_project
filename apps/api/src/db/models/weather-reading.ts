import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';

export class WeatherReading extends Model<
  InferAttributes<WeatherReading>,
  InferCreationAttributes<WeatherReading>
> {
  declare id: CreationOptional<string>;
  declare zone_id: string;
  declare observed_at: Date;
  declare temp_c: CreationOptional<string | null>;
  declare precipitation_mm: CreationOptional<string | null>;
  declare wind_kph: CreationOptional<string | null>;
  declare visibility_m: CreationOptional<number | null>;
  declare condition_code: CreationOptional<string | null>;
  declare source: CreationOptional<'api' | 'synthetic'>;
  declare created_at: CreationOptional<Date>;
}

export function initWeatherReading(sequelize: Sequelize): typeof WeatherReading {
  WeatherReading.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      zone_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      observed_at: { type: DataTypes.DATE(3), allowNull: false },
      temp_c: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      precipitation_mm: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
      wind_kph: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      visibility_m: { type: DataTypes.MEDIUMINT.UNSIGNED, allowNull: true },
      condition_code: { type: DataTypes.STRING(32), allowNull: true },
      source: { type: DataTypes.ENUM('api', 'synthetic'), allowNull: false, defaultValue: 'synthetic' },
      created_at: DataTypes.DATE(3),
    },
    { sequelize, tableName: 'weather_readings', underscored: true, updatedAt: false },
  );
  return WeatherReading;
}
