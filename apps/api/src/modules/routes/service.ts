import { QueryTypes } from 'sequelize';
import { sequelize } from '../../db/index.ts';
import { selectGeom } from '../../db/spatial.ts';
import { env } from '../../config/env.ts';
import { AppError } from '../../lib/errors.ts';
import { parseLineString } from '../../db/spatial.ts';

/**
 * M04 route planning.
 *
 * Express owns the data and the contract; the ML service owns the search
 * (design.md §2). The whole subgraph travels in the request payload because the
 * ML service holds no database credentials — at 152 edges that is a few hundred
 * kilobytes and keeps the service stateless.
 */

interface EdgeRow {
  segment_id: string;
  from_node: string;
  to_node: string;
  name: string | null;
  length_m: string;
  speed_free_kph: string;
  gradient_pct: string;
  road_class: string;
  one_way: number;
  congestion_index: string | null;
  safety_score: string;
  wkt: string | null;
}

/**
 * Provisional safety score, 0–100.
 *
 * M09 owns `segment_safety_scores` and will replace this with something fitted
 * to real incident data. Until then a constant 70 for every road made the
 * `safest` profile mathematically identical to `fastest` — with no variation
 * between edges, the safety term just scales distance and cannot change which
 * route wins.
 *
 * This derives a score from attributes the schema already carries, which is
 * enough to make the profiles genuinely differ and is defensible on its own
 * terms: lighting and a bike lane make a road safer for micromobility, while
 * high free-flow speed and multiple lanes make it more dangerous.
 */
const SAFETY_SQL = `
  LEAST(100, GREATEST(0,
      60
    + IF(rs.lit, 12, -8)
    + IF(rs.has_bike_lane, 18, 0)
    + CASE rs.road_class
        WHEN 'cycleway' THEN 20
        WHEN 'path'     THEN 14
        WHEN 'local'    THEN 6
        WHEN 'collector' THEN -4
        ELSE -14
      END
    - (rs.speed_free_kph - 30) * 0.4
    - (rs.lanes - 1) * 4
  ))`;

export interface PlanEdge {
  segmentId: string;
  fromNode: string;
  toNode: string;
  name: string | null;
  lengthM: number;
  speedFreeKph: number;
  gradientPct: number;
  roadClass: string;
  oneWay: boolean;
  congestionIndex: number;
  safetyScore: number;
  geometry: number[][];
}

/** The routable network, with live congestion folded in. */
export async function loadGraph(): Promise<PlanEdge[]> {
  const rows = await sequelize.query<EdgeRow>(
    `SELECT rs.id AS segment_id, rs.from_node, rs.to_node, rs.name,
            rs.length_m, rs.speed_free_kph, rs.gradient_pct, rs.road_class, rs.one_way,
            COALESCE(ts.congestion_index, 0) AS congestion_index,
            ${SAFETY_SQL} AS safety_score,
            ${selectGeom('rs.geometry', 'wkt')}
     FROM road_segments rs
     LEFT JOIN traffic_snapshots ts ON ts.segment_id = rs.id`,
    { type: QueryTypes.SELECT },
  );

  return rows.map((r) => {
    const line = parseLineString(r.wkt);
    return {
      segmentId: String(r.segment_id),
      fromNode: r.from_node,
      toNode: r.to_node,
      name: r.name,
      lengthM: Number(r.length_m),
      speedFreeKph: Number(r.speed_free_kph),
      gradientPct: Number(r.gradient_pct),
      roadClass: r.road_class,
      oneWay: Boolean(r.one_way),
      congestionIndex: Number(r.congestion_index ?? 0),
      safetyScore: Number(r.safety_score),
      geometry: line ? line.coordinates.map((c) => [c[0], c[1]]) : [],
    };
  });
}

async function callMl<T>(path: string, payload: unknown): Promise<T> {
  if (!env.mlServiceUrl) {
    throw new AppError('SERVICE_UNAVAILABLE', 'The ML service is not configured');
  }

  let res: Response;
  try {
    res = await fetch(`${env.mlServiceUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': env.mlInternalSecret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppError(
      'SERVICE_UNAVAILABLE',
      'The routing service is not reachable. Is it running on port 8000?',
    );
  }

  if (res.status === 422) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new AppError('NO_ROUTE_FOUND', body.detail ?? 'No route exists between those points');
  }
  if (!res.ok) {
    throw new AppError('SERVICE_UNAVAILABLE', `Routing service returned ${res.status}`);
  }

  return (await res.json()) as T;
}

export interface PlanInput {
  origin: [number, number];
  destination: [number, number];
  mode: string;
  profile: string;
}

export async function planRoute(input: PlanInput): Promise<unknown> {
  const edges = await loadGraph();
  return callMl('/internal/routing/plan', { ...input, edges });
}

export async function compareRoutes(
  input: Omit<PlanInput, 'profile'>,
): Promise<{ routes: unknown[] }> {
  const edges = await loadGraph();
  return callMl('/internal/routing/compare', { ...input, edges });
}
