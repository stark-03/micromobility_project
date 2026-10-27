import { describe, expect, it } from 'vitest';
import type {
  PricingPlanDto,
  RentalStationDetailDto,
  StationVehicleDto,
  VehicleType,
} from '@mm/shared-types';
import { recommend } from '../../src/modules/rentals/recommend.ts';
import { batteryFor } from '../../src/modules/rentals/specs.ts';

function plan(type: VehicleType, unlock: number, perMin: number): PricingPlanDto {
  return {
    id: type,
    vehicleType: type,
    name: type,
    currency: 'INR',
    unlockFeeMinor: unlock,
    perMinuteMinor: perMin,
    minimumFareMinor: unlock,
  };
}

const PLANS = new Map<VehicleType, PricingPlanDto>([
  ['bike', plan('bike', 500, 100)],
  ['scooter', plan('scooter', 1000, 200)],
  ['ebike', plan('ebike', 1000, 150)],
  ['ev', plan('ev', 2500, 400)],
]);

let n = 0;
function vehicle(type: VehicleType, pct: number | null, status = 'available'): StationVehicleDto {
  n += 1;
  return {
    id: String(n),
    externalRef: `V-${n}`,
    unlockCode: `CODE${String(n).padStart(4, '0')}`,
    type,
    status: status as StationVehicleDto['status'],
    battery: batteryFor(type, pct),
    rentable: status === 'available' && (type === 'bike' || (pct ?? 0) >= 15),
  };
}

function station(
  id: string,
  distanceM: number,
  vehicles: StationVehicleDto[],
): RentalStationDetailDto {
  return {
    id,
    code: `RS-${id}`,
    name: `Station ${id}`,
    zoneName: null,
    location: [74.5, 15.85],
    capacity: 12,
    freeDocks: 12 - vehicles.length,
    status: 'active',
    inventory: [],
    rentableTotal: vehicles.filter((v) => v.rentable).length,
    distanceM,
    vehicles,
  };
}

describe('recommend', () => {
  it('never offers a vehicle that cannot finish the trip with a margin', () => {
    // A scooter at 20% has 5 km of range; a 6 km trip needs 7.2 km with margin.
    const out = recommend({
      tripDistanceM: 6000,
      stations: [station('A', 100, [vehicle('scooter', 20)])],
      plans: PLANS,
    });
    expect(out.recommendations).toHaveLength(0);
    expect(out.nearestStationNote).toMatch(/enough charge/);
  });

  it('suggests an alternative station when the nearest has nothing suitable', () => {
    const out = recommend({
      tripDistanceM: 3000,
      stations: [
        station('NEAR', 80, [vehicle('scooter', 16, 'charging')]),
        station('FAR', 600, [vehicle('ebike', 90)]),
      ],
      plans: PLANS,
    });
    expect(out.nearestStation?.id).toBe('NEAR');
    expect(out.nearestStationNote).toMatch(/no vehicles available/);
    expect(out.recommendations[0]!.station.id).toBe('FAR');
    expect(out.recommendations[0]!.alternative).toBe(true);
    expect(out.recommendations[0]!.reasons.join(' ')).toMatch(/further than Station NEAR/);
  });

  it('picks the most charged vehicle of a type at a station', () => {
    const out = recommend({
      tripDistanceM: 2000,
      stations: [
        station('A', 50, [vehicle('ebike', 40), vehicle('ebike', 95), vehicle('ebike', 60)]),
      ],
      plans: PLANS,
    });
    expect(out.recommendations[0]!.vehicle.battery.pct).toBe(95);
  });

  it('weighs cost: for a short hop the cheap pedal bike beats the micro-EV', () => {
    const out = recommend({
      tripDistanceM: 1500,
      stations: [station('A', 50, [vehicle('bike', null), vehicle('ev', 90)])],
      plans: PLANS,
    });
    const order = out.recommendations.map((r) => r.vehicleType);
    expect(order.indexOf('bike')).toBeLessThan(order.indexOf('ev'));
    const bike = out.recommendations.find((r) => r.vehicleType === 'bike')!;
    expect(bike.batteryMarginPct).toBeNull();
    expect(bike.reasons).toContain('Cheapest fare');
  });

  it('quotes a fare for each option on that type’s tariff', () => {
    const out = recommend({
      tripDistanceM: 4000,
      stations: [station('A', 50, [vehicle('scooter', 90), vehicle('ebike', 90)])],
      plans: PLANS,
    });
    for (const r of out.recommendations) {
      expect(r.fare.unlockFeeMinor).toBe(PLANS.get(r.vehicleType)!.unlockFeeMinor);
      expect(r.fare.totalMinor).toBeGreaterThan(0);
    }
  });

  it('ranks 1..n with scores ascending', () => {
    const out = recommend({
      tripDistanceM: 3000,
      stations: [
        station('A', 100, [vehicle('scooter', 80), vehicle('bike', null)]),
        station('B', 400, [vehicle('ebike', 90), vehicle('ev', 70)]),
      ],
      plans: PLANS,
    });
    expect(out.recommendations.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    const scores = out.recommendations.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });
});
