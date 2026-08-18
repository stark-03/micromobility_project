import { QueryTypes } from 'sequelize';
import { sequelize } from '../../db/index.ts';
import { selectGeom, parsePoint } from '../../db/spatial.ts';
import { env } from '../../config/env.ts';
import { AppError } from '../../lib/errors.ts';

/**
 * M07 — fleet optimisation.
 *
 * Express assembles the world (supply from the vehicle registry, demand from
 * the M05 forecast), the ML service solves, and Express persists the plan and
 * the crew tasks. The solve itself is the transportation LP in
 * `apps/ml/app/fleet/rebalance.py` — the same function the M06 simulator uses
 * for its rebalancing lever.
 */

export interface ZoneSupplyDemand {
  zoneId: string;
  name: string;
  code: string;
  lat: number;
  lng: number;
  /** Vehicles currently available in the zone. */
  supply: number;
  /** Forecast TRIPS over the horizon, from M05. Shown to the planner as-is. */
  forecastDemand: number;
  /** This zone's proportional share of the fleet that actually exists. */
  targetVehicles: number;
  /** supply - targetVehicles. Sums to ~0 across the city, by construction. */
  gap: number;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

interface ZoneRow {
  id: string;
  name: string;
  code: string;
  population_ix: string | null;
  centroid_wkt: string | null;
  available: string;
  forecast: string | null;
}

/**
 * Supply and expected demand per zone over the horizon.
 *
 * Demand comes from `demand_forecasts` when the M05 model has run. When it has
 * not, the fallback is that zone's own trip history for this hour of the week
 * — NOT zero. A zero-demand fallback would make every zone look oversupplied
 * and the optimiser would confidently plan nothing, which reads as "no work
 * needed" rather than "no forecast available".
 */
export async function supplyAndDemand(horizonHours = 2): Promise<ZoneSupplyDemand[]> {
  const rows = await sequelize.query<ZoneRow>(
    `SELECT z.id, z.name, z.code, z.population_ix,
            ${selectGeom('z.centroid', 'centroid_wkt')},
            (SELECT COUNT(*) FROM vehicles v
              WHERE v.home_zone_id = z.id
                AND v.deleted_at IS NULL
                AND v.status = 'available')                       AS available,
            (SELECT SUM(df.predicted_trips) FROM demand_forecasts df
              WHERE df.zone_id = z.id
                AND df.slot_start >= NOW(3)
                AND df.slot_start <  DATE_ADD(NOW(3), INTERVAL :hours HOUR)) AS forecast
       FROM zones z
      ORDER BY z.id`,
    { replacements: { hours: horizonHours }, type: QueryTypes.SELECT },
  );

  const anyForecast = rows.some((r) => r.forecast !== null);

  // One history query for the whole city rather than one per zone.
  const history = anyForecast
    ? []
    : await sequelize.query<{ zone_id: string; per_hour: string }>(
        `SELECT start_zone_id AS zone_id,
                COUNT(*) / GREATEST(1, COUNT(DISTINCT DATE(started_at))) / 24 AS per_hour
           FROM trips
          WHERE started_at >= DATE_SUB(NOW(3), INTERVAL 28 DAY)
            AND start_zone_id IS NOT NULL
          GROUP BY start_zone_id`,
        { type: QueryTypes.SELECT },
      );
  const perHourByZone = new Map(history.map((h) => [String(h.zone_id), num(h.per_hour)]));

  const zonesWithDemand = rows
    .map((r) => {
      const point = r.centroid_wkt ? parsePoint(r.centroid_wkt) : null;
      if (!point) return null;
      const [lng, lat] = point.coordinates;

      const supply = num(r.available);
      const forecastDemand =
        r.forecast !== null
          ? num(r.forecast)
          : // Population-scaled floor when a zone has no history either, so a
            // brand-new zone is not silently treated as needing nothing.
            (perHourByZone.get(String(r.id)) ?? num(r.population_ix, 5) * 0.35) * horizonHours;

      return {
        zoneId: String(r.id),
        name: r.name,
        code: r.code,
        lat,
        lng,
        supply,
        forecastDemand: Number(forecastDemand.toFixed(3)),
      };
    })
    .filter((z): z is Omit<ZoneSupplyDemand, 'targetVehicles' | 'gap'> => z !== null);

  return allocate(zonesWithDemand);
}

/**
 * Turns trip demand into a vehicle target, proportionally.
 *
 * Two things were wrong with comparing forecast trips directly against vehicles
 * on the ground, and both made the optimiser useless:
 *
 * 1. **Wrong unit.** A vehicle serves several trips over a two-hour horizon, so
 *    "20 trips forecast, 4 vehicles present" is not a shortage of 16.
 * 2. **Wrong question.** At peak every zone is short in absolute terms, so an
 *    absolute-surplus rule finds nothing to move and reports "no zone has spare
 *    vehicles" — true, and useless. Rebalancing does not create vehicles; it
 *    decides where the ones you have should stand.
 *
 * So the target is each zone's demand-weighted share of the *existing* fleet.
 * Gaps then sum to zero: whenever one zone is under its share another is over
 * it, and there is always a move worth considering. This is also what an
 * operations team actually does at 8am — not "buy more scooters", but "we have
 * thirty, and Shahapur should have eight of them".
 */
function allocate(
  zones: Omit<ZoneSupplyDemand, 'targetVehicles' | 'gap'>[],
): ZoneSupplyDemand[] {
  const totalSupply = zones.reduce((n, z) => n + z.supply, 0);
  const totalDemand = zones.reduce((n, z) => n + z.forecastDemand, 0);

  return zones.map((z) => {
    // With no demand signal anywhere, an equal split is the only defensible
    // target — it at least does not pretend one zone matters more.
    const share = totalDemand > 0 ? z.forecastDemand / totalDemand : 1 / Math.max(1, zones.length);
    const target = totalSupply * share;
    return {
      ...z,
      targetVehicles: Number(target.toFixed(2)),
      gap: Number((z.supply - target).toFixed(3)),
    };
  });
}

interface MlMove {
  fromZoneId: string;
  toZoneId: string;
  vehicles: number;
  distanceKm: number;
}

interface MlPlan {
  status: string;
  totalVehicles: number;
  totalDistanceKm: number;
  deficitBefore: number;
  deficitAfter: number;
  notes: string[];
  moves: MlMove[];
}

async function callMl<T>(path: string, payload: unknown): Promise<T> {
  if (!env.mlServiceUrl) {
    throw new AppError('SERVICE_UNAVAILABLE', 'The ML service is not configured');
  }
  let res: Response;
  try {
    res = await fetch(`${env.mlServiceUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': env.mlInternalSecret },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE', 'The ML service is not reachable');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
    throw new AppError(
      'SERVICE_UNAVAILABLE',
      typeof body.detail === 'string' ? body.detail : `ML service returned ${res.status}`,
    );
  }
  return (await res.json()) as T;
}

export interface CreatePlanInput {
  horizonHours: number;
  vanCount: number;
  vanCapacity: number;
  valuePerVehicleKm: number;
}

export async function createRebalancePlan(input: CreatePlanInput, userId: string) {
  const zones = await supplyAndDemand(input.horizonHours);
  if (zones.length === 0) {
    throw new AppError('SERVICE_UNAVAILABLE', 'No zones are seeded; nothing to rebalance');
  }

  const plan = await callMl<MlPlan>('/internal/fleet/rebalance', {
    zones: zones.map((z) => ({
      zoneId: z.zoneId,
      name: z.name,
      lat: z.lat,
      lng: z.lng,
      supply: z.supply,
      // The solver balances against the vehicle target, not raw trip counts.
      demand: z.targetVehicles,
    })),
    vanCount: input.vanCount,
    vanCapacity: input.vanCapacity,
    valuePerVehicleKm: input.valuePerVehicleKm,
  });

  // One transaction: a plan without its tasks is a plan nobody can execute,
  // and a snapshot without its plan cannot explain one.
  return sequelize.transaction(async (tx) => {
    const [planId] = await sequelize.query(
      `INSERT INTO rebalance_plans
         (status, horizon_hours, van_count, van_capacity, value_per_vehicle_km,
          total_vehicles, total_distance_km, deficit_before, deficit_after, notes, created_by)
       VALUES (:status, :horizon, :vans, :capacity, :value,
               :vehicles, :distance, :before, :after, :notes, :user)`,
      {
        replacements: {
          status: plan.status === 'planned' ? 'planned' : 'no_action',
          horizon: input.horizonHours,
          vans: input.vanCount,
          capacity: input.vanCapacity,
          value: input.valuePerVehicleKm,
          vehicles: plan.totalVehicles,
          distance: plan.totalDistanceKm,
          before: plan.deficitBefore,
          after: plan.deficitAfter,
          notes: JSON.stringify(plan.notes ?? []),
          user: userId,
        },
        transaction: tx,
      },
    );

    const id = String(planId);

    for (const [i, m] of plan.moves.entries()) {
      await sequelize.query(
        `INSERT INTO rebalance_tasks
           (plan_id, sequence, from_zone_id, to_zone_id, vehicles, distance_km)
         VALUES (:plan, :seq, :from, :to, :vehicles, :km)`,
        {
          replacements: {
            plan: id,
            seq: i + 1,
            from: m.fromZoneId,
            to: m.toZoneId,
            vehicles: m.vehicles,
            km: m.distanceKm,
          },
          transaction: tx,
        },
      );
    }

    for (const z of zones) {
      await sequelize.query(
        `INSERT INTO zone_supply_snapshots (plan_id, zone_id, supply, forecast_demand, gap)
         VALUES (:plan, :zone, :supply, :demand, :gap)`,
        {
          replacements: {
            plan: id,
            zone: z.zoneId,
            supply: z.supply,
            demand: z.forecastDemand,
            gap: z.gap,
          },
          transaction: tx,
        },
      );
    }

    return id;
  });
}

export interface RebalanceTaskDto {
  id: string;
  sequence: number;
  fromZoneId: string;
  fromZoneName: string;
  toZoneId: string;
  toZoneName: string;
  vehicles: number;
  distanceKm: number;
  status: string;
  completedAt: string | null;
}

export interface RebalancePlanDto {
  id: string;
  status: string;
  horizonHours: number;
  vanCount: number;
  vanCapacity: number;
  valuePerVehicleKm: number;
  totalVehicles: number;
  totalDistanceKm: number;
  deficitBefore: number;
  deficitAfter: number;
  notes: string[];
  createdAt: string;
  tasks: RebalanceTaskDto[];
}

export async function getRebalancePlan(planId: string): Promise<RebalancePlanDto> {
  const [plan] = await sequelize.query<Record<string, unknown>>(
    'SELECT * FROM rebalance_plans WHERE id = :id',
    { replacements: { id: planId }, type: QueryTypes.SELECT },
  );
  if (!plan) throw new AppError('PLAN_NOT_FOUND', `No rebalance plan ${planId}`);

  const tasks = await sequelize.query<Record<string, unknown>>(
    `SELECT t.*, zf.name AS from_name, zt.name AS to_name
       FROM rebalance_tasks t
       JOIN zones zf ON zf.id = t.from_zone_id
       JOIN zones zt ON zt.id = t.to_zone_id
      WHERE t.plan_id = :id
      ORDER BY t.sequence`,
    { replacements: { id: planId }, type: QueryTypes.SELECT },
  );

  return {
    id: String(plan.id),
    status: String(plan.status),
    horizonHours: num(plan.horizon_hours),
    vanCount: num(plan.van_count),
    vanCapacity: num(plan.van_capacity),
    valuePerVehicleKm: num(plan.value_per_vehicle_km),
    totalVehicles: num(plan.total_vehicles),
    totalDistanceKm: num(plan.total_distance_km),
    deficitBefore: num(plan.deficit_before),
    deficitAfter: num(plan.deficit_after),
    notes: Array.isArray(plan.notes) ? (plan.notes as string[]) : [],
    createdAt: new Date(plan.created_at as string).toISOString(),
    tasks: tasks.map((t) => ({
      id: String(t.id),
      sequence: num(t.sequence),
      fromZoneId: String(t.from_zone_id),
      fromZoneName: String(t.from_name),
      toZoneId: String(t.to_zone_id),
      toZoneName: String(t.to_name),
      vehicles: num(t.vehicles),
      distanceKm: num(t.distance_km),
      status: String(t.status),
      completedAt: t.completed_at ? new Date(t.completed_at as string).toISOString() : null,
    })),
  };
}

export async function listRebalancePlans(limit = 20): Promise<RebalancePlanDto[]> {
  const rows = await sequelize.query<{ id: string }>(
    'SELECT id FROM rebalance_plans ORDER BY created_at DESC LIMIT :limit',
    { replacements: { limit }, type: QueryTypes.SELECT },
  );
  return Promise.all(rows.map((r) => getRebalancePlan(String(r.id))));
}

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'skipped';

export async function updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
  const [task] = await sequelize.query<{ id: string; plan_id: string }>(
    'SELECT id, plan_id FROM rebalance_tasks WHERE id = :id',
    { replacements: { id: taskId }, type: QueryTypes.SELECT },
  );
  if (!task) throw new AppError('TASK_NOT_FOUND', `No rebalance task ${taskId}`);

  await sequelize.query(
    `UPDATE rebalance_tasks
        SET status = :status,
            completed_at = CASE WHEN :status IN ('done','skipped') THEN NOW(3) ELSE NULL END
      WHERE id = :id`,
    { replacements: { id: taskId, status } },
  );

  // A plan is finished when none of its tasks are outstanding. Deriving it here
  // rather than making a crew press "complete plan" means the status cannot
  // disagree with the tasks it summarises.
  await sequelize.query(
    `UPDATE rebalance_plans p
        SET p.status = CASE
              WHEN NOT EXISTS (SELECT 1 FROM rebalance_tasks t
                                WHERE t.plan_id = p.id AND t.status IN ('pending','in_progress'))
                THEN 'completed'
              WHEN EXISTS (SELECT 1 FROM rebalance_tasks t
                            WHERE t.plan_id = p.id AND t.status <> 'pending')
                THEN 'in_progress'
              ELSE 'planned' END
      WHERE p.id = :plan`,
    { replacements: { plan: task.plan_id } },
  );
}
