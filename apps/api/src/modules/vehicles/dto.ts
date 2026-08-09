import { z } from 'zod';
import {
  TICKET_SEVERITIES,
  TICKET_STATUSES,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
} from '@mm/shared-types';
import type {
  MaintenanceTicketDto,
  TelemetryDto,
  VehicleDto,
  VehicleStatusHistoryDto,
  VehicleStatus,
  VehicleType,
} from '@mm/shared-types';
import type { MaintenanceTicket } from '../../db/models/index.ts';
import { parsePoint } from '../../db/spatial.ts';

const numericId = z.string().regex(/^\d+$/, 'Must be a numeric id');

export const listVehiclesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  zoneId: numericId.optional(),
  operatorId: numericId.optional(),
  status: z.enum(VEHICLE_STATUSES).optional(),
  type: z.enum(VEHICLE_TYPES).optional(),
});

export const createVehicleSchema = z.object({
  operatorId: numericId,
  externalRef: z.string().min(1).max(64).trim(),
  type: z.enum(VEHICLE_TYPES),
  homeZoneId: numericId.nullable().optional(),
  batteryPct: z.number().int().min(0).max(100).nullable().optional(),
  position: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).optional(),
});

export const updateVehicleSchema = z
  .object({
    homeZoneId: numericId.nullable().optional(),
    batteryPct: z.number().int().min(0).max(100).nullable().optional(),
    position: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).optional(),
  })
  .strict();

export const changeStatusSchema = z.object({
  to: z.enum(VEHICLE_STATUSES),
  reason: z.string().min(1).max(160).trim().optional(),
});

export const idParamSchema = z.object({ id: numericId });

/**
 * `from` and `to` are REQUIRED. vehicle_telemetry is partitioned by month and
 * CLAUDE.md forbids querying these tables un-bounded by time — an open-ended
 * scan defeats partition pruning and reads the whole table.
 */
export const telemetryQuerySchema = z.object({
  from: z.string().datetime({ message: 'from must be an ISO-8601 timestamp' }),
  to: z.string().datetime({ message: 'to must be an ISO-8601 timestamp' }),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const historyQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const createTicketSchema = z.object({
  title: z.string().min(3).max(160).trim(),
  description: z.string().max(5000).trim().nullable().optional(),
  severity: z.enum(TICKET_SEVERITIES).default('medium'),
  source: z.enum(['manual', 'telemetry', 'inspection']).default('manual'),
  faultCode: z.string().max(32).trim().nullable().optional(),
  assignedTo: numericId.nullable().optional(),
});

export const updateTicketSchema = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    severity: z.enum(TICKET_SEVERITIES).optional(),
    assignedTo: numericId.nullable().optional(),
  })
  .strict();

export type ListVehiclesQuery = z.infer<typeof listVehiclesQuerySchema>;
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
export type ChangeStatusInput = z.infer<typeof changeStatusSchema>;
export type TelemetryQuery = z.infer<typeof telemetryQuerySchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;

// ---- row shapes returned by the raw geometry-aware queries -----------------

export interface VehicleRow {
  id: string;
  operator_id: string;
  operator_name: string | null;
  home_zone_id: string | null;
  home_zone_name: string | null;
  external_ref: string;
  type: VehicleType;
  status: VehicleStatus;
  battery_pct: number | null;
  last_seen_at: Date | null;
  last_wkt: string | null;
  created_at: Date;
  updated_at: Date;
}

export function toVehicleDto(r: VehicleRow): VehicleDto {
  return {
    id: String(r.id),
    operatorId: String(r.operator_id),
    operatorName: r.operator_name,
    homeZoneId: r.home_zone_id === null ? null : String(r.home_zone_id),
    homeZoneName: r.home_zone_name,
    externalRef: r.external_ref,
    type: r.type,
    status: r.status,
    batteryPct: r.battery_pct === null ? null : Number(r.battery_pct),
    lastSeenAt: r.last_seen_at === null ? null : new Date(r.last_seen_at).toISOString(),
    lastPosition: parsePoint(r.last_wkt),
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export interface HistoryRow {
  id: string;
  vehicle_id: string;
  from_status: VehicleStatus | null;
  to_status: VehicleStatus;
  reason: string | null;
  changed_by: string | null;
  changed_by_name: string | null;
  changed_at: Date;
}

export function toHistoryDto(r: HistoryRow): VehicleStatusHistoryDto {
  return {
    id: String(r.id),
    vehicleId: String(r.vehicle_id),
    fromStatus: r.from_status,
    toStatus: r.to_status,
    reason: r.reason,
    changedById: r.changed_by === null ? null : String(r.changed_by),
    changedByName: r.changed_by_name,
    changedAt: new Date(r.changed_at).toISOString(),
  };
}

export interface TelemetryRow {
  id: string;
  vehicle_id: string;
  recorded_at: Date;
  lat: string | null;
  lng: string | null;
  speed_kph: string | null;
  battery_pct: number | null;
  odometer_m: string | null;
  lock_state: 'locked' | 'unlocked' | null;
  fault_code: string | null;
  source: 'gps' | 'sensor' | 'synthetic';
}

export function toTelemetryDto(r: TelemetryRow): TelemetryDto {
  // Position is stored as lat/lng DECIMAL rather than a POINT, because MySQL
  // forbids GEOMETRY columns on partitioned tables. The GeoPoint is rebuilt
  // here so the API contract matches every other positioned entity.
  const hasPosition = r.lat !== null && r.lng !== null;
  return {
    id: String(r.id),
    vehicleId: String(r.vehicle_id),
    recordedAt: new Date(r.recorded_at).toISOString(),
    position: hasPosition
      ? { type: 'Point', coordinates: [Number(r.lng), Number(r.lat)] }
      : null,
    speedKph: r.speed_kph === null ? null : Number(r.speed_kph),
    batteryPct: r.battery_pct === null ? null : Number(r.battery_pct),
    odometerM: r.odometer_m === null ? null : Number(r.odometer_m),
    lockState: r.lock_state,
    faultCode: r.fault_code,
    source: r.source,
  };
}

export function toTicketDto(t: MaintenanceTicket): MaintenanceTicketDto {
  return {
    id: String(t.id),
    vehicleId: String(t.vehicle_id),
    operatorId: String(t.operator_id),
    reportedById: t.reported_by === null ? null : String(t.reported_by),
    assignedToId: t.assigned_to === null ? null : String(t.assigned_to),
    source: t.source,
    severity: t.severity,
    status: t.status,
    title: t.title,
    description: t.description ?? null,
    faultCode: t.fault_code ?? null,
    openedAt: t.opened_at.toISOString(),
    resolvedAt: t.resolved_at?.toISOString() ?? null,
  };
}
