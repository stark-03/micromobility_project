// ---- envelopes -------------------------------------------------------------

export interface ApiMeta {
  page?: number;
  limit?: number;
  total?: number;
  nextCursor?: string | null;
}

export interface ApiSuccess<T> {
  data: T;
  meta?: ApiMeta;
}

export interface ApiErrorDetail {
  path: string;
  message: string;
}

export interface ApiError {
  error: { code: ErrorCode; message: string; details?: ApiErrorDetail[] };
}

// ---- stable error codes ----------------------------------------------------
// `code` is what the frontend switches on. `message` is for humans and may change.

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'TOKEN_EXPIRED',
  'REFRESH_TOKEN_INVALID',
  'REFRESH_TOKEN_REUSED',
  'FORBIDDEN',
  'ROUTE_NOT_FOUND',
  'USER_NOT_FOUND',
  'VEHICLE_NOT_FOUND',
  'MAINTENANCE_TICKET_NOT_FOUND',
  'SAVED_PLACE_NOT_FOUND',
  'EMAIL_ALREADY_REGISTERED',
  'VEHICLE_REF_ALREADY_EXISTS',
  'SAVED_PLACE_LABEL_EXISTS',
  'LAST_ADMIN_PROTECTED',
  'INVALID_STATE_TRANSITION',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

// ---- domain enums ----------------------------------------------------------
// Const objects rather than TS `enum`: Node's type stripping cannot erase an
// enum, and `erasableSyntaxOnly` rejects it at typecheck.

export const ROLES = ['admin', 'planner', 'operator', 'commuter', 'analyst', 'device'] as const;
export type Role = (typeof ROLES)[number];

export const VEHICLE_TYPES = ['scooter', 'bike', 'ebike', 'ev'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_STATUSES = [
  'available',
  'reserved',
  'in_use',
  'returning',
  'charging',
  'maintenance',
  'retired',
] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const ROAD_CLASSES = ['arterial', 'collector', 'local', 'path', 'cycleway'] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'cancelled'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type TicketSeverity = (typeof TICKET_SEVERITIES)[number];

export const USER_STATUSES = ['active', 'suspended', 'pending'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

// ---- geometry --------------------------------------------------------------
// ALWAYS [lng, lat]. MySQL treats SRID 4326 as lat-lng; db/spatial.ts converts
// at the boundary so nothing above it ever has to think about axis order.

export type LngLat = [number, number];

export interface GeoPoint {
  type: 'Point';
  coordinates: LngLat;
}

export interface GeoLineString {
  type: 'LineString';
  coordinates: LngLat[];
}

export interface GeoPolygon {
  type: 'Polygon';
  coordinates: LngLat[][];
}

// ---- DTOs ------------------------------------------------------------------
// Every `id` is a string: BIGINT UNSIGNED exceeds Number.MAX_SAFE_INTEGER, so
// ids cross the wire as strings and mysql2 is configured to return them as such.

export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  status: UserStatus;
  roles: Role[];
  operatorId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface UserPreferencesDto {
  language: string;
  units: 'metric' | 'imperial';
  preferredVehicleType: VehicleType | null;
  theme: 'dark' | 'light';
  notificationsEnabled: boolean;
}

export interface SavedPlaceDto {
  id: string;
  label: string;
  address: string | null;
  kind: 'home' | 'work' | 'other';
  position: GeoPoint;
  createdAt: string;
}

export interface VehicleDto {
  id: string;
  operatorId: string;
  operatorName: string | null;
  homeZoneId: string | null;
  homeZoneName: string | null;
  externalRef: string;
  type: VehicleType;
  status: VehicleStatus;
  batteryPct: number | null;
  lastSeenAt: string | null;
  lastPosition: GeoPoint | null;
  createdAt: string;
  updatedAt: string;
}

export interface VehicleStatusHistoryDto {
  id: string;
  vehicleId: string;
  fromStatus: VehicleStatus | null;
  toStatus: VehicleStatus;
  reason: string | null;
  changedById: string | null;
  changedByName: string | null;
  changedAt: string;
}

export interface TelemetryDto {
  id: string;
  vehicleId: string;
  recordedAt: string;
  position: GeoPoint | null;
  speedKph: number | null;
  batteryPct: number | null;
  odometerM: number | null;
  lockState: 'locked' | 'unlocked' | null;
  faultCode: string | null;
  source: 'gps' | 'sensor' | 'synthetic';
}

export interface MaintenanceTicketDto {
  id: string;
  vehicleId: string;
  operatorId: string;
  reportedById: string | null;
  assignedToId: string | null;
  source: 'manual' | 'telemetry' | 'inspection';
  severity: TicketSeverity;
  status: TicketStatus;
  title: string;
  description: string | null;
  faultCode: string | null;
  openedAt: string;
  resolvedAt: string | null;
}

export interface TripDto {
  id: string;
  publicRef: string;
  vehicleId: string;
  operatorId: string;
  startZoneId: string | null;
  endZoneId: string | null;
  startedAt: string;
  endedAt: string | null;
  startPosition: GeoPoint | null;
  endPosition: GeoPoint | null;
  distanceM: number | null;
  durationS: number | null;
  status: 'active' | 'completed' | 'cancelled';
}

export interface ZoneDto {
  id: string;
  code: string;
  name: string;
  centroid: GeoPoint;
  boundary: GeoPolygon | null;
  populationIx: number | null;
}

export interface OperatorDto {
  id: string;
  code: string;
  name: string;
  status: 'active' | 'inactive';
}

export interface ApiKeyDto {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  operatorId: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

// ---- M02 traffic / M12 weather ---------------------------------------------

export interface SegmentTrafficDto {
  segmentId: string;
  name: string | null;
  zoneId: string | null;
  roadClass: RoadClass;
  geometry: GeoLineString;
  lengthM: number;
  speedFreeKph: number;
  meanSpeedKph: number | null;
  vehicleCount: number | null;
  occupancy: number | null;
  /** 0 = free flow, 1 = jammed. Maps onto the --flow-* ramp. */
  congestionIndex: number;
  /** 0-4 bucket for the legend, derived from congestionIndex. */
  flowBand: 0 | 1 | 2 | 3 | 4;
  computedAt: string | null;
}

export interface TrafficLiveDto {
  segments: SegmentTrafficDto[];
  generatedAt: string;
  /** Mean congestion across the returned segments. */
  cityCongestionIndex: number;
}

export interface WeatherDto {
  zoneId: string;
  zoneName: string;
  observedAt: string;
  tempC: number | null;
  precipitationMm: number | null;
  windKph: number | null;
  visibilityM: number | null;
  conditionCode: string | null;
}

export interface KpiDto {
  vehiclesTotal: number;
  vehiclesAvailable: number;
  vehiclesInUse: number;
  segmentsMonitored: number;
  cityCongestionIndex: number;
  congestedSegments: number;
  readingsLastHour: number;
  tripsToday: number;
}

/** Bucket a 0-1 congestion index into the five-step --flow-* ramp. */
export function flowBandFor(index: number): 0 | 1 | 2 | 3 | 4 {
  if (index < 0.2) return 0;
  if (index < 0.4) return 1;
  if (index < 0.6) return 2;
  if (index < 0.8) return 3;
  return 4;
}

export interface AuthResponseDto {
  accessToken: string;
  user: UserDto;
}
