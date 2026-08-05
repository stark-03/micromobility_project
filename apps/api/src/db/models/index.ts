import type { Sequelize } from 'sequelize';
import { sequelize } from '../index.ts';
import { ApiKey, initApiKey } from './api-key.ts';
import { AuditLog, initAuditLog } from './audit-log.ts';
import { initMaintenanceTicket, MaintenanceTicket } from './maintenance-ticket.ts';
import { initOperator, Operator } from './operator.ts';
import { initRefreshToken, RefreshToken } from './refresh-token.ts';
import { initRoadSegment, RoadSegment } from './road-segment.ts';
import { initRole, Role } from './role.ts';
import { initSavedPlace, SavedPlace } from './saved-place.ts';
import { initTrip, Trip } from './trip.ts';
import { initUser, User } from './user.ts';
import { initUserPreference, UserPreference } from './user-preference.ts';
import { initUserRole, UserRole } from './user-role.ts';
import { initVehicle, Vehicle } from './vehicle.ts';
import { initVehicleStatusHistory, VehicleStatusHistory } from './vehicle-status-history.ts';
import { initVehicleTelemetry, VehicleTelemetry } from './vehicle-telemetry.ts';
import { initZone, Zone } from './zone.ts';

let initialised = false;

export function initModels(s: Sequelize) {
  // Init in migration order so anything reading the registry sees a sane order.
  initRole(s);
  initOperator(s);
  initUser(s);
  initUserRole(s);
  initRefreshToken(s);
  initUserPreference(s);
  initSavedPlace(s);
  initApiKey(s);
  initAuditLog(s);
  initZone(s);
  initRoadSegment(s);
  initVehicle(s);
  initVehicleStatusHistory(s);
  initVehicleTelemetry(s);
  initMaintenanceTicket(s);
  initTrip(s);

  // ---- associations --------------------------------------------------------

  Operator.hasMany(User, { foreignKey: 'operator_id', as: 'users' });
  User.belongsTo(Operator, { foreignKey: 'operator_id', as: 'operator' });

  User.belongsToMany(Role, {
    through: UserRole,
    foreignKey: 'user_id',
    otherKey: 'role_id',
    as: 'roles',
  });
  Role.belongsToMany(User, {
    through: UserRole,
    foreignKey: 'role_id',
    otherKey: 'user_id',
    as: 'users',
  });

  User.hasMany(RefreshToken, { foreignKey: 'user_id', as: 'refreshTokens' });
  RefreshToken.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

  User.hasOne(UserPreference, { foreignKey: 'user_id', as: 'preferences' });
  UserPreference.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

  User.hasMany(SavedPlace, { foreignKey: 'user_id', as: 'places' });
  SavedPlace.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

  ApiKey.belongsTo(Operator, { foreignKey: 'operator_id', as: 'operator' });
  ApiKey.belongsTo(User, { foreignKey: 'created_by', as: 'creator' });

  Zone.hasMany(RoadSegment, { foreignKey: 'zone_id', as: 'segments' });
  RoadSegment.belongsTo(Zone, { foreignKey: 'zone_id', as: 'zone' });

  Operator.hasMany(Vehicle, { foreignKey: 'operator_id', as: 'vehicles' });
  Vehicle.belongsTo(Operator, { foreignKey: 'operator_id', as: 'operator' });
  Vehicle.belongsTo(Zone, { foreignKey: 'home_zone_id', as: 'homeZone' });

  Vehicle.hasMany(VehicleStatusHistory, { foreignKey: 'vehicle_id', as: 'statusHistory' });
  VehicleStatusHistory.belongsTo(Vehicle, { foreignKey: 'vehicle_id', as: 'vehicle' });
  VehicleStatusHistory.belongsTo(User, { foreignKey: 'changed_by', as: 'changedBy' });

  Vehicle.hasMany(MaintenanceTicket, { foreignKey: 'vehicle_id', as: 'tickets' });
  MaintenanceTicket.belongsTo(Vehicle, { foreignKey: 'vehicle_id', as: 'vehicle' });
  MaintenanceTicket.belongsTo(Operator, { foreignKey: 'operator_id', as: 'operator' });
  MaintenanceTicket.belongsTo(User, { foreignKey: 'reported_by', as: 'reporter' });
  MaintenanceTicket.belongsTo(User, { foreignKey: 'assigned_to', as: 'assignee' });

  Vehicle.hasMany(Trip, { foreignKey: 'vehicle_id', as: 'trips' });
  Trip.belongsTo(Vehicle, { foreignKey: 'vehicle_id', as: 'vehicle' });
  Trip.belongsTo(Operator, { foreignKey: 'operator_id', as: 'operator' });
  Trip.belongsTo(Zone, { foreignKey: 'start_zone_id', as: 'startZone' });
  Trip.belongsTo(Zone, { foreignKey: 'end_zone_id', as: 'endZone' });
  User.hasMany(Trip, { foreignKey: 'user_id', as: 'trips' });
  Trip.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

  // NOTE: VehicleTelemetry gets NO association to Vehicle on purpose. The table
  // is RANGE-partitioned and MySQL forbids foreign keys on partitioned tables,
  // so there is no constraint for an association to lean on. Joins would also
  // encourage un-bounded scans of a table that must always be queried by
  // vehicle_id + time range. Do not "fix" this.

  initialised = true;
  return models;
}

export const models = {
  Role,
  Operator,
  User,
  UserRole,
  RefreshToken,
  UserPreference,
  SavedPlace,
  ApiKey,
  AuditLog,
  Zone,
  RoadSegment,
  Vehicle,
  VehicleStatusHistory,
  VehicleTelemetry,
  MaintenanceTicket,
  Trip,
};

/** Idempotent: safe to call from any entrypoint (server, CLI, tests). */
export function ensureModels(s: Sequelize = sequelize) {
  if (!initialised) initModels(s);
  return models;
}

export {
  ApiKey,
  AuditLog,
  MaintenanceTicket,
  Operator,
  RefreshToken,
  RoadSegment,
  Role,
  SavedPlace,
  Trip,
  User,
  UserPreference,
  UserRole,
  Vehicle,
  VehicleStatusHistory,
  VehicleTelemetry,
  Zone,
};
