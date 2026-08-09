import { DataTypes, Model } from 'sequelize';
import type { CreationOptional, InferAttributes, InferCreationAttributes, Sequelize } from 'sequelize';

export class WeatherForecast extends Model<
  InferAttributes<WeatherForecast>,
  InferCreationAttributes<WeatherForecast>
> {
  declare id: CreationOptional<string>;
  declare zone_id: string;
  declare issued_at: CreationOptional<Date>;
  declare forecast_for: Date;
  declare temp_c: CreationOptional<string | null>;
  declare precipitation_mm: CreationOptional<string | null>;
  declare wind_kph: CreationOptional<string | null>;
  declare condition_code: CreationOptional<string | null>;
  declare created_at: CreationOptional<Date>;
  declare updated_at: CreationOptional<Date>;
}

export function initWeatherForecast(sequelize: Sequelize): typeof WeatherForecast {
  WeatherForecast.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      zone_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      issued_at: { type: DataTypes.DATE(3), allowNull: false, defaultValue: DataTypes.NOW },
      forecast_for: { type: DataTypes.DATE(3), allowNull: false },
      temp_c: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      precipitation_mm: { type: DataTypes.DECIMAL(6, 2), allowNull: true },
      wind_kph: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
      condition_code: { type: DataTypes.STRING(32), allowNull: true },
      created_at: DataTypes.DATE(3),
      updated_at: DataTypes.DATE(3),
    },
    { sequelize, tableName: 'weather_forecasts', underscored: true },
  );
  return WeatherForecast;
}
