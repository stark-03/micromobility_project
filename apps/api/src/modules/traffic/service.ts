import { QueryTypes } from 'sequelize';
import { flowBandFor } from '@mm/shared-types';
import type { SegmentTrafficDto, TrafficLiveDto } from '@mm/shared-types';
import { sequelize } from '../../db/index.ts';
import { parseLineString, selectGeom } from '../../db/spatial.ts';
import { cache } from '../../cache/index.ts';
import { CACHE_KEYS } from '../../cache/keys.ts';
import { bus } from '../../realtime/bus.ts';

interface LiveRow {
  segment_id: string;
  name: string | null;
  zone_id: string | null;
  road_class: SegmentTrafficDto['roadClass'];
  geom_wkt: string | null;
  length_m: string;
  speed_free_kph: string;
  mean_speed_kph: string | null;
  vehicle_count: number | null;
  occupancy: string | null;
  congestion_index: string | null;
  computed_at: Date | null;
}

function toDto(r: LiveRow): SegmentTrafficDto {
  const geometry = parseLineString(r.geom_wkt);
  if (!geometry) throw new Error(`Segment ${r.segment_id} has no geometry`);
  const congestionIndex = r.congestion_index === null ? 0 : Number(r.congestion_index);

  return {
    segmentId: String(r.segment_id),
    name: r.name,
    zoneId: r.zone_id === null ? null : String(r.zone_id),
    roadClass: r.road_class,
    geometry,
    lengthM: Number(r.length_m),
    speedFreeKph: Number(r.speed_free_kph),
    meanSpeedKph: r.mean_speed_kph === null ? null : Number(r.mean_speed_kph),
    vehicleCount: r.vehicle_count === null ? null : Number(r.vehicle_count),
    occupancy: r.occupancy === null ? null : Number(r.occupancy),
    congestionIndex,
    flowBand: flowBandFor(congestionIndex),
    computedAt: r.computed_at === null ? null : new Date(r.computed_at).toISOString(),
  };
}

/**
 * Reads traffic_snapshots, never traffic_readings.
 *
 * design.md §3.3: raw telemetry is written once and never scanned by the UI.
 * A LEFT JOIN keeps every segment on the map even before any reading has
 * arrived — an un-monitored road should render grey, not vanish.
 */
async function loadLive(zoneId?: string): Promise<TrafficLiveDto> {
  const where = zoneId ? 'WHERE rs.zone_id = ?' : '';
  const reps = zoneId ? [zoneId] : [];

  const rows = await sequelize.query<LiveRow>(
    `SELECT rs.id AS segment_id, rs.name, rs.zone_id, rs.road_class,
            ${selectGeom('rs.geometry', 'geom_wkt')},
            rs.length_m, rs.speed_free_kph,
            ts.mean_speed_kph, ts.vehicle_count, ts.occupancy,
            ts.congestion_index, ts.computed_at
     FROM road_segments rs
     LEFT JOIN traffic_snapshots ts ON ts.segment_id = rs.id
     ${where}
     ORDER BY rs.id`,
    { type: QueryTypes.SELECT, replacements: reps },
  );

  const segments = rows.map(toDto);
  const measured = segments.filter((s) => s.computedAt !== null);
  const cityCongestionIndex =
    measured.length === 0
      ? 0
      : Number(
          (measured.reduce((n, s) => n + s.congestionIndex, 0) / measured.length).toFixed(3),
        );

  return { segments, generatedAt: new Date().toISOString(), cityCongestionIndex };
}

/** 15 s TTL via the cache adapter, per CLAUDE.md's declared key list. */
export function getLiveTraffic(zoneId?: string): Promise<TrafficLiveDto> {
  const spec = CACHE_KEYS.trafficSnapshot(zoneId ?? 'city');
  return cache.wrap(spec.key, spec.ttl, () => loadLive(zoneId));
}

export interface SnapshotResult {
  segmentsUpdated: number;
  cityCongestionIndex: number;
}

/**
 * Rolls the last `windowSeconds` of traffic_readings into traffic_snapshots.
 *
 * congestion_index = 1 - (mean_speed / speed_free), clamped to [0,1]. A segment
 * moving at or above its free-flow speed is 0; a stationary one is 1.
 *
 * Runs every minute from a cron job, and on demand from the generator so a demo
 * does not have to wait for the next tick.
 */
export async function rebuildSnapshots(windowSeconds = 120): Promise<SnapshotResult> {
  await sequelize.query(
    `INSERT INTO traffic_snapshots
       (segment_id, zone_id, computed_at, mean_speed_kph, vehicle_count, occupancy,
        congestion_index, sample_count)
     SELECT
       rs.id,
       rs.zone_id,
       NOW(3),
       AVG(tr.mean_speed_kph),
       ROUND(AVG(tr.vehicle_count)),
       AVG(tr.occupancy),
       LEAST(1.000, GREATEST(0.000,
         1 - (AVG(tr.mean_speed_kph) / NULLIF(rs.speed_free_kph, 0))
       )),
       COUNT(*)
     FROM road_segments rs
     JOIN traffic_readings tr
       ON tr.segment_id = rs.id
      AND tr.observed_at >= DATE_SUB(NOW(3), INTERVAL ? SECOND)
     GROUP BY rs.id, rs.zone_id, rs.speed_free_kph
     ON DUPLICATE KEY UPDATE
       zone_id          = VALUES(zone_id),
       computed_at      = VALUES(computed_at),
       mean_speed_kph   = VALUES(mean_speed_kph),
       vehicle_count    = VALUES(vehicle_count),
       occupancy        = VALUES(occupancy),
       congestion_index = VALUES(congestion_index),
       sample_count     = VALUES(sample_count)`,
    { replacements: [windowSeconds] },
  );

  const [row] = await sequelize.query<{ n: string; avg: string | null }>(
    `SELECT COUNT(*) AS n, AVG(congestion_index) AS avg FROM traffic_snapshots`,
    { type: QueryTypes.SELECT },
  );

  const segmentsUpdated = Number(row?.n ?? 0);
  const cityCongestionIndex = Number(Number(row?.avg ?? 0).toFixed(3));

  // The snapshot is the cached thing; invalidate so the next read is fresh.
  await cache.del(CACHE_KEYS.trafficSnapshot('city').key);

  bus.emit('traffic:update', {
    segmentsUpdated,
    cityCongestionIndex,
    at: new Date().toISOString(),
  });

  return { segmentsUpdated, cityCongestionIndex };
}
