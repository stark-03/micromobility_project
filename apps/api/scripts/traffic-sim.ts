import { QueryTypes } from 'sequelize';
import { sequelize } from '../src/db/index.ts';
import { ensureModels } from '../src/db/models/index.ts';
import { rebuildSnapshots } from '../src/modules/traffic/service.ts';

/**
 * Synthetic traffic generator.
 *
 * There are no real sensors on Belagavi's roads, so this stands in for them —
 * it writes plausible readings for every seeded segment on a loop, which is
 * what makes the live map move during a demo.
 *
 * The pattern is deterministic given (segment, time): a diurnal curve with
 * morning and evening peaks, modulated by road class, plus two roaming
 * congestion "hotspots" that drift across the city so the map visibly changes
 * rather than sitting at a fixed pattern.
 *
 *   npm run traffic:sim                  # loop every 5s until Ctrl-C
 *   npm run traffic:sim -- --once        # a single tick, then exit
 *   npm run traffic:sim -- --interval 2000
 *   npm run traffic:sim -- --hour 18.5   # pin to evening rush, whatever the clock says
 *
 * --hour exists for demos: a viva at 11pm would otherwise show a uniformly
 * free-flowing city, which demonstrates nothing.
 */

interface SegmentRow {
  id: string;
  speed_free_kph: string;
  road_class: string;
  zone_id: string | null;
}

const args = process.argv.slice(2);
const once = args.includes('--once');
const intervalIdx = args.indexOf('--interval');
const intervalMs = intervalIdx >= 0 ? Number(args[intervalIdx + 1] ?? 5000) : 5000;
const hourIdx = args.indexOf('--hour');
const forcedHour = hourIdx >= 0 ? Number(args[hourIdx + 1]) : null;

/** Fraction of free-flow speed by hour of day. 1 = free, 0.25 = crawling. */
function diurnalFactor(hour: number, minute: number): number {
  const t = hour + minute / 60;
  const morning = Math.exp(-((t - 9) ** 2) / 2.2); // ~09:00 peak
  const evening = Math.exp(-((t - 18.5) ** 2) / 2.8); // ~18:30 peak
  const lunch = 0.35 * Math.exp(-((t - 13) ** 2) / 1.5);
  const load = Math.min(1, morning + evening + lunch);
  return 1 - 0.7 * load; // busiest hour still moves at 30% of free flow
}

/** Arterials clog first; a cycleway barely notices rush hour. */
const CLASS_SENSITIVITY: Record<string, number> = {
  arterial: 1.0,
  collector: 0.8,
  local: 0.6,
  path: 0.25,
  cycleway: 0.2,
};

/**
 * Two hotspots orbiting the city, so consecutive ticks differ visibly.
 * Deterministic in `tick` — no Math.random anywhere, so a demo can be replayed.
 */
function hotspotFactor(segmentIndex: number, total: number, tick: number): number {
  const pos = segmentIndex / Math.max(1, total);
  let worst = 0;
  for (const [i, speed] of [0.013, -0.007].entries()) {
    const centre = (0.25 + i * 0.5 + tick * speed) % 1;
    const d = Math.min(Math.abs(pos - centre), 1 - Math.abs(pos - centre));
    worst = Math.max(worst, Math.exp(-(d ** 2) / 0.004));
  }
  return worst;
}

async function tickOnce(tick: number): Promise<{ rows: number; congestion: number }> {
  // Arterials and collectors only. Real traffic services colour main corridors
  // and leave side streets alone; instrumenting 7,476 residential lanes would
  // swamp the database for nothing anyone would look at.
  const segments = await sequelize.query<SegmentRow>(
    `SELECT id, speed_free_kph, road_class, zone_id FROM road_segments
     WHERE road_class IN ('arterial','collector') ORDER BY id`,
    { type: QueryTypes.SELECT },
  );
  if (segments.length === 0) {
    throw new Error('No road segments found. Run `npm run db:seed` first.');
  }

  const now = new Date();
  const base =
    forcedHour === null
      ? diurnalFactor(now.getHours(), now.getMinutes())
      : diurnalFactor(Math.floor(forcedHour), (forcedHour % 1) * 60);

  const placeholders: string[] = [];
  const reps: unknown[] = [];

  segments.forEach((s, i) => {
    const free = Number(s.speed_free_kph);
    const sensitivity = CLASS_SENSITIVITY[s.road_class] ?? 0.6;
    const hotspot = hotspotFactor(i, segments.length, tick);

    // Blend the time-of-day curve with the roaming hotspot.
    const slowdown = 1 - (1 - base) * sensitivity - 0.55 * hotspot * sensitivity;
    const factor = Math.min(1, Math.max(0.08, slowdown));

    const meanSpeed = Number((free * factor).toFixed(2));
    const occupancy = Number(Math.min(0.999, 1 - factor).toFixed(4));
    const vehicleCount = Math.round((1 - factor) * 60 + 3);

    placeholders.push('(?, ?, ?, ?, ?, ?)');
    reps.push(s.id, now, meanSpeed, vehicleCount, occupancy, 'synthetic');
  });

  // Chunked: a single statement with thousands of tuples can exceed
  // max_allowed_packet, and the failure mode is an opaque connection reset.
  const CHUNK = 500;
  for (let i = 0; i < placeholders.length; i += CHUNK) {
    const slice = placeholders.slice(i, i + CHUNK);
    await sequelize.query(
      `INSERT INTO traffic_readings
         (segment_id, observed_at, mean_speed_kph, vehicle_count, occupancy, source)
       VALUES ${slice.join(',')}`,
      { replacements: reps.slice(i * 6, (i + slice.length) * 6) },
    );
  }

  const result = await rebuildSnapshots(120);
  return { rows: segments.length, congestion: result.cityCongestionIndex };
}

ensureModels();

let tick = 0;
let stopping = false;

async function loop(): Promise<void> {
  const { rows, congestion } = await tickOnce(tick);
  const bar = '▁▂▃▅▇'[Math.min(4, Math.floor(congestion * 5))] ?? '▁';
  console.log(
    `tick ${String(tick).padStart(4)}  ${rows} segments  city congestion ${congestion.toFixed(3)} ${bar}`,
  );
  tick += 1;
}

if (once) {
  await loop();
  await sequelize.close();
} else {
  console.log(`Synthetic traffic every ${intervalMs}ms. Ctrl-C to stop.\n`);
  await loop();
  const timer = setInterval(() => {
    if (stopping) return;
    void loop().catch((e: unknown) => {
      console.error('tick failed:', e instanceof Error ? e.message : e);
    });
  }, intervalMs);

  const shutdown = () => {
    stopping = true;
    clearInterval(timer);
    void sequelize.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
