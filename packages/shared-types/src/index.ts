// ---- envelopes -------------------------------------------------------------

export interface ApiMeta {
  page?: number;
  limit?: number;
  total?: number;
  nextCursor?: string | null;
  /** Range metadata for M11 analytics responses. Dates are YYYY-MM-DD. */
  from?: string;
  to?: string;
  days?: number;
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
  'NO_ROUTE_FOUND',
  'SCENARIO_NOT_FOUND',
  'RUN_NOT_FOUND',
  'RUN_NOT_COMPLETED',
  'PLAN_NOT_FOUND',
  'TASK_NOT_FOUND',
  'STATION_NOT_FOUND',
  'RENTAL_NOT_FOUND',
  'VEHICLE_NOT_RENTABLE',
  'RENTAL_ALREADY_ACTIVE',
  'RETURN_NOT_AT_STATION',
  'STATION_FULL',
  'PAYMENT_FAILED',
  'SERVICE_UNAVAILABLE',
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
  /** The code printed on the vehicle as a QR sticker. */
  unlockCode: string | null;
  /** The rental station it is docked at, if any. */
  stationId: string | null;
  stationName: string | null;
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

// ---- M04 route planning -----------------------------------------------------

export const ROUTE_PROFILES = ['fastest', 'safest', 'greenest'] as const;
export type RouteProfile = (typeof ROUTE_PROFILES)[number];

export interface RouteStepDto {
  segmentId: string;
  name: string | null;
  roadClass: RoadClass;
  lengthM: number;
  durationS: number;
  congestionIndex: number;
}

export interface RouteDto {
  profile: RouteProfile;
  mode: VehicleType;
  geometry: GeoLineString;
  distanceM: number;
  durationS: number;
  etaMinutes: number;
  elevationGainM: number;
  energyWh: number;
  /** 0-100, higher is riskier. Equal to `risk.score` once the API has scored the route. */
  riskScore: number;
  /** M09: risk from accidents, road quality, traffic, lighting and cycling infrastructure. */
  risk?: RouteRiskDto;
  meanCongestion: number;
  steps: RouteStepDto[];
  nodeCount: number;
  snappedOrigin: LngLat | null;
  snappedDestination: LngLat | null;
  snapDistanceM: number;
}

export interface RouteCompareDto {
  routes: RouteDto[];
}

export interface AuthResponseDto {
  accessToken: string;
  user: UserDto;
}

// ---- M06 simulation --------------------------------------------------------

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface FleetMixDto {
  scooter: number;
  ebike: number;
  bike: number;
}

export interface ScenarioWeatherDto {
  precipitationMm: number;
  tempC: number;
}

/** The what-if. Every field here must change a number the planner can see. */
export interface PolicyLeversDto {
  bikeLaneZones: string[];
  closedZones: string[];
  demandMultiplier: number;
  rebalanceEnabled: boolean;
  rebalanceIntervalMin: number;
  rebalanceVanCapacity: number;
}

export interface ScenarioDto {
  id: string;
  name: string;
  description: string | null;
  simHours: number;
  startHour: number;
  fleet: FleetMixDto;
  weather: ScenarioWeatherDto;
  policy: PolicyLeversDto;
  baselineRunId: string | null;
  createdBy: string;
  createdAt: string;
  runCount: number;
  latestRun: SimulationRunDto | null;
}

/**
 * Metrics are a flat string→number map rather than a fixed interface because
 * the set grows per module (M07 adds rebalancing cost, M10 emissions splits)
 * and the storage is a narrow key/value table. The keys below are the ones
 * present today; a client must tolerate extras.
 */
export type SimulationMetrics = Record<string, number>;

export interface SimulationRunDto {
  id: string;
  scenarioId: string;
  scenarioName: string | null;
  seed: number;
  status: RunStatus;
  /** 0–1. */
  progress: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  metrics: SimulationMetrics;
  /** Non-scalar breakdowns: per-kind utilisation, unserved reason codes. */
  detail: Record<string, unknown> | null;
}

export interface SimulationTimelinePointDto {
  bucket: number;
  simMinutes: number;
  tripsServed: number;
  tripsUnserved: number;
  meanWaitSeconds: number;
  safetyIncidents: number;
}

/** `neutral`: the metric changed, but up is not better or worse in itself. */
export type CompareDirection = 'better' | 'worse' | 'same' | 'neutral';

export interface CompareRowDto {
  metric: string;
  baseline: number;
  variant: number;
  delta: number;
  deltaPct: number | null;
  /**
   * Whether the change is an improvement. Sign alone cannot say: more trips
   * served is better, more trips unserved is worse, and both are positive.
   */
  direction: CompareDirection;
}

export interface RunComparisonDto {
  baseline: SimulationRunDto;
  variant: SimulationRunDto;
  rows: CompareRowDto[];
}

export interface RunProgressEvent {
  runId: string;
  scenarioId: string;
  pct: number;
  simSeconds: number;
  tripsServed: number;
  tripsUnserved: number;
}

export interface RunCompletedEvent {
  runId: string;
  scenarioId: string;
  status: 'completed' | 'failed';
  durationMs: number | null;
  error: string | null;
}

// ---- M08 rental stations ---------------------------------------------------

/** What a vehicle's battery can do, from its type's spec and its charge. */
export interface BatteryDto {
  /** Null for a pedal bike: there is no battery. */
  pct: number | null;
  capacityWh: number | null;
  /** Metres of riding left at this charge; null when there is no battery. */
  rangeM: number | null;
}

export interface StationVehicleDto {
  id: string;
  externalRef: string;
  unlockCode: string;
  type: VehicleType;
  status: VehicleStatus;
  battery: BatteryDto;
  /** Rentable right now: available, and charged enough to be worth riding. */
  rentable: boolean;
}

/** Counts for one vehicle type at one station. */
export interface StationInventoryDto {
  type: VehicleType;
  /** Available and charged enough to rent. */
  rentable: number;
  /** Docked but charging, in maintenance, reserved or too flat. */
  unavailable: number;
}

export interface RentalStationDto {
  id: string;
  code: string;
  name: string;
  zoneName: string | null;
  location: LngLat;
  capacity: number;
  /** Docks still free for a return. */
  freeDocks: number;
  status: 'active' | 'closed';
  inventory: StationInventoryDto[];
  rentableTotal: number;
  distanceM?: number;
}

export interface RentalStationDetailDto extends RentalStationDto {
  vehicles: StationVehicleDto[];
}

// ---- M14 pricing and rentals -----------------------------------------------

export interface PricingPlanDto {
  id: string;
  vehicleType: VehicleType;
  name: string;
  currency: string;
  /** All money in the API is integer minor units (paise). */
  unlockFeeMinor: number;
  perMinuteMinor: number;
  minimumFareMinor: number;
}

export interface FareBreakdownDto {
  currency: string;
  unlockFeeMinor: number;
  timeFeeMinor: number;
  minutes: number;
  /** Added when the ride came in under the plan's minimum. */
  minimumTopUpMinor: number;
  totalMinor: number;
}

/** What scanning a QR code tells the rider before they commit. */
export interface UnlockPreviewDto {
  vehicle: StationVehicleDto;
  stationName: string | null;
  plan: PricingPlanDto;
  /** Why it cannot be rented, when it cannot. */
  notRentableReason: string | null;
}

export interface FareEstimateDto {
  vehicleType: VehicleType;
  plan: PricingPlanDto;
  distanceM: number;
  durationS: number;
  fare: FareBreakdownDto;
}

/** One way to make the trip: a vehicle type, from a station, and why. */
export interface VehicleRecommendationDto {
  rank: number;
  vehicleType: VehicleType;
  station: RentalStationDto;
  /** The best vehicle of this type at that station — highest charge. */
  vehicle: StationVehicleDto;
  walkM: number;
  rideDurationS: number;
  fare: FareBreakdownDto;
  /** Range left after the trip, as a share of the battery's range. Null for a pedal bike. */
  batteryMarginPct: number | null;
  /** 0–1, lower is better. */
  score: number;
  /** True when this comes from a station other than the nearest one. */
  alternative: boolean;
  reasons: string[];
}

export interface RecommendationResponseDto {
  tripDistanceM: number;
  /** Where the trip distance came from — the router, or a straight-line estimate when it was down. */
  distanceSource: 'route' | 'estimate';
  nearestStation: RentalStationDto | null;
  /** Why the nearest station is not the top pick, when it isn't. */
  nearestStationNote: string | null;
  recommendations: VehicleRecommendationDto[];
}

export type RentalStatus = 'active' | 'completed' | 'cancelled';

export interface RentalDto {
  id: string;
  publicRef: string;
  status: RentalStatus;
  vehicle: { id: string; externalRef: string; unlockCode: string; type: VehicleType; battery: BatteryDto };
  startStation: { id: string; name: string } | null;
  endStation: { id: string; name: string } | null;
  startedAt: string;
  endedAt: string | null;
  startPosition: LngLat | null;
  endPosition: LngLat | null;
  distanceM: number;
  durationS: number;
  plan: PricingPlanDto | null;
  /** Running fare while active; the charged fare once completed. */
  fare: FareBreakdownDto | null;
  energyWh: number | null;
  co2SavedG: number | null;
  /** The GPS trace, oldest first. Only ever returned to the rider who took the trip. */
  path: LngLat[];
  payment: PaymentDto | null;
}

export interface PaymentDto {
  id: string;
  amountMinor: number;
  currency: string;
  provider: string;
  providerRef: string | null;
  status: 'pending' | 'succeeded' | 'failed';
  createdAt: string;
}

export interface ReceiptDto {
  receiptNo: string;
  issuedAt: string;
  rider: { name: string; email: string };
  operatorName: string;
  rental: RentalDto;
}

export interface EcoSummaryDto {
  trips: number;
  distanceKm: number;
  rideMinutes: number;
  spentMinor: number;
  currency: string;
  energyKwh: number;
  co2SavedKg: number;
  byType: Array<{ type: VehicleType; trips: number; distanceKm: number; co2SavedKg: number }>;
  /** The assumption the CO2 figure rests on — stated, not implied. */
  counterfactual: string;
}

// ---- M09 route risk --------------------------------------------------------

export type RiskLevel = 'low' | 'medium' | 'high';

export interface RouteRiskDto {
  /** 0–100, higher is riskier. */
  score: number;
  level: RiskLevel;
  /** Each 0–100, higher is riskier, length-weighted over the route. */
  factors: {
    accidents: number;
    roadQuality: number;
    traffic: number;
    lighting: number;
    infrastructure: number;
  };
  incidentCount: number;
  /** Share of the route's length with no surface survey. */
  unsurveyedPct: number;
}

// ---- place search ----------------------------------------------------------

export type PlaceKind = 'zone' | 'street' | 'rental_station' | 'charging_station' | 'saved';

export interface PlaceDto {
  id: string;
  kind: PlaceKind;
  name: string;
  /** Zone or other context, for telling two "Main Road"s apart. */
  context: string | null;
  location: LngLat;
}
