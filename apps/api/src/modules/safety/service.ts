import { QueryTypes } from 'sequelize';
import type { RouteRiskDto } from '@mm/shared-types';
import { sequelize } from '../../db/index.ts';
import { routeRisk } from './risk.ts';
import type { SegmentRiskInput } from './risk.ts';

/** How far back accident history counts. Older roads were often different roads. */
export const INCIDENT_LOOKBACK_YEARS = 3;

interface SegmentRow {
  id: string;
  road_class: string;
  has_bike_lane: number;
  lit: number;
  surface_quality: number | null;
  minor: string | null;
  serious: string | null;
  fatal: string | null;
}

/** The route's own step, as the router returns it. */
export interface RiskStep {
  segmentId: string;
  lengthM: number;
  congestionIndex: number;
}

/**
 * Risk for one route, from its steps.
 *
 * Congestion comes from the step, not from a fresh read of traffic_snapshots:
 * the router planned on the congestion it saw, and scoring the same route on a
 * snapshot taken a second later could disagree with the ETA beside it.
 */
export async function riskForSteps(steps: RiskStep[]): Promise<RouteRiskDto> {
  const ids = [...new Set(steps.map((s) => s.segmentId))];
  if (ids.length === 0) return routeRisk([]);

  const rows = await sequelize.query<SegmentRow>(
    `SELECT rs.id, rs.road_class, rs.has_bike_lane, rs.lit, rs.surface_quality,
            SUM(i.severity = 'minor')   AS minor,
            SUM(i.severity = 'serious') AS serious,
            SUM(i.severity = 'fatal')   AS fatal
       FROM road_segments rs
       LEFT JOIN incidents i
              ON i.segment_id = rs.id
             AND i.occurred_at >= DATE_SUB(NOW(3), INTERVAL ${INCIDENT_LOOKBACK_YEARS} YEAR)
      WHERE rs.id IN (:ids)
      GROUP BY rs.id`,
    { replacements: { ids }, type: QueryTypes.SELECT },
  );
  const byId = new Map(rows.map((r) => [String(r.id), r]));

  const inputs: SegmentRiskInput[] = [];
  for (const step of steps) {
    const r = byId.get(String(step.segmentId));
    if (!r) continue;
    inputs.push({
      lengthM: step.lengthM,
      roadClass: r.road_class,
      hasBikeLane: Boolean(r.has_bike_lane),
      lit: Boolean(r.lit),
      surfaceQuality: r.surface_quality === null ? null : Number(r.surface_quality),
      congestion: step.congestionIndex,
      incidents: {
        minor: Number(r.minor ?? 0),
        serious: Number(r.serious ?? 0),
        fatal: Number(r.fatal ?? 0),
      },
    });
  }
  return routeRisk(inputs);
}
