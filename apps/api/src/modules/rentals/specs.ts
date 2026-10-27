import type { BatteryDto, VehicleType } from '@mm/shared-types';

/**
 * Per-type vehicle specifications.
 *
 * One table, because battery capacity, full-charge range and riding speed are
 * read by stations, recommendations, rentals and the nearby-vehicles query, and
 * four copies of "how far does a full scooter go" would drift apart.
 *
 * Typical figures for shared fleets, not a specific manufacturer's datasheet.
 */
export interface VehicleSpec {
  /** Null for a pedal bike. */
  capacityWh: number | null;
  /** Metres on a full charge, flat ground, one rider. Null for a pedal bike. */
  fullRangeM: number | null;
  /** Average door-to-door riding speed in town, including junctions. */
  cruiseKph: number;
}

export const VEHICLE_SPECS: Readonly<Record<VehicleType, VehicleSpec>> = Object.freeze({
  scooter: { capacityWh: 470, fullRangeM: 25_000, cruiseKph: 18 },
  ebike: { capacityWh: 500, fullRangeM: 45_000, cruiseKph: 20 },
  bike: { capacityWh: null, fullRangeM: null, cruiseKph: 14 },
  ev: { capacityWh: 7_000, fullRangeM: 120_000, cruiseKph: 25 },
});

/**
 * Below this a vehicle is not offered for rent. A scooter at 10% has about
 * 2.5 km in it — less than a typical trip, and a rider stranded mid-ride is the
 * worst outcome the system can produce.
 */
export const MIN_RENTABLE_BATTERY_PCT = 15;

/**
 * Range is only promised with a margin. Batteries sag on hills, in the cold and
 * with a heavier rider, so a vehicle must cover the trip with 20% to spare.
 */
export const RANGE_SAFETY_FACTOR = 1.2;

/** A return at or below this goes to `charging` instead of `available`. */
export const RETURN_TO_CHARGE_BELOW_PCT = 20;

export function batteryFor(type: VehicleType, pct: number | null): BatteryDto {
  const spec = VEHICLE_SPECS[type];
  if (spec.capacityWh === null || spec.fullRangeM === null) {
    return { pct: null, capacityWh: null, rangeM: null };
  }
  const charge = Math.max(0, Math.min(100, pct ?? 0));
  return {
    pct: charge,
    capacityWh: spec.capacityWh,
    rangeM: Math.round((charge / 100) * spec.fullRangeM),
  };
}

/** Can this vehicle be rented at all, ignoring trip length? */
export function isRentable(type: VehicleType, status: string, pct: number | null): boolean {
  if (status !== 'available') return false;
  if (VEHICLE_SPECS[type].capacityWh === null) return true;
  return (pct ?? 0) >= MIN_RENTABLE_BATTERY_PCT;
}

/** Can it make *this* trip, with the safety margin? Pedal bikes always can. */
export function canCover(type: VehicleType, pct: number | null, tripM: number): boolean {
  const { rangeM } = batteryFor(type, pct);
  return rangeM === null || rangeM >= tripM * RANGE_SAFETY_FACTOR;
}

/** Seconds to ride `distanceM` on this type. */
export function rideSeconds(type: VehicleType, distanceM: number): number {
  return Math.round(distanceM / (VEHICLE_SPECS[type].cruiseKph / 3.6));
}

/**
 * Battery percent used to ride `distanceM`.
 *
 * Straight proportion of full range — the same model the range figure uses, so
 * "range left" before a ride and "battery used" after it agree with each other.
 */
export function batteryUsedPct(type: VehicleType, distanceM: number): number {
  const full = VEHICLE_SPECS[type].fullRangeM;
  return full === null ? 0 : (distanceM / full) * 100;
}
