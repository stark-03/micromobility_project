import type {
  PricingPlanDto,
  RentalStationDetailDto,
  RentalStationDto,
  VehicleRecommendationDto,
  VehicleType,
} from '@mm/shared-types';
import { computeFare } from './pricing.ts';
import { batteryFor, canCover, rideSeconds } from './specs.ts';

/**
 * Which vehicle should this rider take, and from where?
 *
 * Pure: the caller supplies stations (with their vehicles), tariffs and the
 * trip length. Every candidate is one vehicle type at one station — the best
 * vehicle of that type there, meaning the one with the most charge.
 *
 * The five factors the rider asked to be weighed:
 *   - travel time  — walk to the station plus the ride itself
 *   - rental cost  — the fare for that ride on that type's tariff
 *   - battery range — charge left over after the trip, so a rider is not
 *                     handed a scooter that will die two streets from home
 *   - availability — how many of that type the station has, since the
 *                    vehicle in front of you may be taken by the time you walk
 *   - distance     — the walk, which riders weigh more than its minutes alone
 *
 * Trip distance itself is a hard filter rather than a factor: a vehicle that
 * cannot cover the trip with a safety margin is not a worse option, it is not
 * an option.
 */

export const WEIGHTS = Object.freeze({
  time: 0.3,
  cost: 0.25,
  battery: 0.2,
  walk: 0.15,
  availability: 0.1,
});

/** Typical urban walking pace. */
const WALK_KPH = 4.8;

interface Candidate {
  type: VehicleType;
  station: RentalStationDetailDto;
  walkM: number;
  rideS: number;
  totalS: number;
  fareMinor: number;
  marginPct: number | null;
  stock: number;
  plan: PricingPlanDto;
}

export interface RecommendInput {
  tripDistanceM: number;
  /** Candidate stations, each with `distanceM` from the rider. */
  stations: RentalStationDetailDto[];
  plans: Map<VehicleType, PricingPlanDto>;
  limit?: number;
}

export interface RecommendOutput {
  nearestStation: RentalStationDto | null;
  nearestStationNote: string | null;
  recommendations: VehicleRecommendationDto[];
}

/** Min–max scale to 0..1. All-equal inputs score 0: nobody is worse. */
function scale(values: number[]): (v: number) => number {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return (v) => (hi === lo ? 0 : (v - lo) / (hi - lo));
}

function km(m: number): string {
  return `${(m / 1000).toFixed(1)} km`;
}

function stripVehicles(s: RentalStationDetailDto): RentalStationDto {
  const station: RentalStationDto & { vehicles?: unknown } = { ...s };
  delete station.vehicles;
  return station;
}

export function recommend(input: RecommendInput): RecommendOutput {
  const { tripDistanceM, plans } = input;
  const stations = [...input.stations].sort(
    (a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity),
  );
  const nearest = stations[0] ?? null;

  const candidates: Candidate[] = [];
  for (const station of stations) {
    const byType = new Map<VehicleType, RentalStationDetailDto['vehicles']>();
    for (const v of station.vehicles) {
      if (!v.rentable || !canCover(v.type, v.battery.pct, tripDistanceM)) continue;
      byType.set(v.type, [...(byType.get(v.type) ?? []), v]);
    }

    for (const [type, vehicles] of byType) {
      const plan = plans.get(type);
      if (!plan) continue;

      const walkM = station.distanceM ?? 0;
      const rideS = rideSeconds(type, tripDistanceM);
      const totalS = Math.round(walkM / (WALK_KPH / 3.6)) + rideS;
      const best = [...vehicles].sort(
        (a, b) => (b.battery.pct ?? 101) - (a.battery.pct ?? 101),
      )[0]!;
      const battery = batteryFor(type, best.battery.pct);
      const marginPct =
        battery.rangeM === null || battery.rangeM === 0
          ? null
          : Math.max(0, Math.round(((battery.rangeM - tripDistanceM) / battery.rangeM) * 100));

      candidates.push({
        type,
        station,
        walkM,
        rideS,
        totalS,
        fareMinor: computeFare(plan, rideS).totalMinor,
        marginPct,
        stock: vehicles.length,
        plan,
      });
    }
  }

  let nearestStationNote: string | null = null;
  if (nearest && !candidates.some((c) => c.station.id === nearest.id)) {
    nearestStationNote =
      nearest.rentableTotal === 0
        ? `${nearest.name} has no vehicles available right now.`
        : `Nothing at ${nearest.name} has enough charge for a ${km(tripDistanceM)} trip.`;
  }

  if (candidates.length === 0) {
    return {
      nearestStation: nearest && stripVehicles(nearest),
      nearestStationNote,
      recommendations: [],
    };
  }

  const sTime = scale(candidates.map((c) => c.totalS));
  const sCost = scale(candidates.map((c) => c.fareMinor));
  const sWalk = scale(candidates.map((c) => c.walkM));
  // A pedal bike has no battery to run out: treat it as a full margin.
  const sBattery = scale(candidates.map((c) => 100 - (c.marginPct ?? 100)));
  const sStock = scale(candidates.map((c) => -c.stock));

  const scored = candidates
    .map((c) => ({
      c,
      score:
        WEIGHTS.time * sTime(c.totalS) +
        WEIGHTS.cost * sCost(c.fareMinor) +
        WEIGHTS.battery * sBattery(100 - (c.marginPct ?? 100)) +
        WEIGHTS.walk * sWalk(c.walkM) +
        WEIGHTS.availability * sStock(-c.stock),
    }))
    .sort((a, b) => a.score - b.score || a.c.walkM - b.c.walkM);

  const fastest = Math.min(...candidates.map((c) => c.totalS));
  const cheapest = Math.min(...candidates.map((c) => c.fareMinor));

  const recommendations = scored.slice(0, input.limit ?? 6).map(({ c, score }, i) => {
    const best = [...c.station.vehicles]
      .filter(
        (v) => v.type === c.type && v.rentable && canCover(v.type, v.battery.pct, tripDistanceM),
      )
      .sort((a, b) => (b.battery.pct ?? 101) - (a.battery.pct ?? 101))[0]!;

    const reasons: string[] = [];
    if (c.totalS === fastest) reasons.push('Fastest door to door');
    if (c.fareMinor === cheapest) reasons.push('Cheapest fare');
    if (c.marginPct === null) reasons.push('Pedal powered — no battery to run out');
    else reasons.push(`About ${c.marginPct}% of its range left after the trip`);
    reasons.push(`${c.stock} ${c.type}${c.stock === 1 ? '' : 's'} available here`);
    if (nearest && c.station.id !== nearest.id) {
      reasons.push(
        `${Math.round(c.walkM - (nearest.distanceM ?? 0))} m further than ${nearest.name}`,
      );
    }

    return {
      rank: i + 1,
      vehicleType: c.type,
      station: stripVehicles(c.station),
      vehicle: best,
      walkM: Math.round(c.walkM),
      rideDurationS: c.rideS,
      fare: computeFare(c.plan, c.rideS),
      batteryMarginPct: c.marginPct,
      score: Number(score.toFixed(4)),
      alternative: nearest !== null && c.station.id !== nearest.id,
      reasons,
    } satisfies VehicleRecommendationDto;
  });

  if (!nearestStationNote && nearest && recommendations[0]?.alternative) {
    nearestStationNote = `${recommendations[0].station.name} is a better start than ${nearest.name}, the nearest station.`;
  }

  return { nearestStation: nearest && stripVehicles(nearest), nearestStationNote, recommendations };
}
