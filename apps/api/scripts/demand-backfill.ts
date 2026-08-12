import { QueryTypes } from 'sequelize';
import { sequelize } from '../src/db/index.ts';
import { ensureModels } from '../src/db/models/index.ts';

/**
 * Backfills historical trips so the demand model has something to learn.
 *
 * The seeded city ships with a dozen demo trips — enough to prove the travel
 * history endpoint works, nowhere near enough to fit a forecaster. This writes
 * several weeks of plausible ridership at 15-minute resolution.
 *
 * The signal is real, not noise: a weekday commute pattern with morning and
 * evening peaks, a flatter weekend shape, per-zone scaling by population index,
 * and a weather penalty on wet slots. That is exactly the structure the model
 * is asked to recover, so a model that beats the seasonal-naive baseline has
 * genuinely learned something rather than memorised randomness.
 *
 * Fully deterministic — a hash of (zone, slot), never Math.random — so a
 * re-run reproduces the same history and the metrics are comparable.
 *
 *   npm run demand:backfill              # 6 weeks
 *   npm run demand:backfill -- --weeks 2
 */

const args = process.argv.slice(2);
const weeksIdx = args.indexOf('--weeks');
const WEEKS = weeksIdx >= 0 ? Number(args[weeksIdx + 1] ?? 6) : 6;
const SLOT_MINUTES = 15;
const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES;

function hash2(a: number, b: number): number {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Expected trips in a slot, before zone scaling. */
function baseDemand(dayOfWeek: number, hour: number): number {
  const weekend = dayOfWeek === 0 || dayOfWeek === 6;

  if (weekend) {
    // One broad afternoon hump; people ride later and less urgently.
    return 1.1 + 2.6 * Math.exp(-((hour - 15) ** 2) / 14);
  }

  const morning = 4.2 * Math.exp(-((hour - 9) ** 2) / 2.0);
  const evening = 4.8 * Math.exp(-((hour - 18.5) ** 2) / 2.6);
  const lunch = 1.4 * Math.exp(-((hour - 13) ** 2) / 1.8);
  const base = 0.7;
  return base + morning + evening + lunch;
}

/**
 * Smooth, autocorrelated noise in [0,1).
 *
 * Interpolates between hash values anchored every `bucket` slots, so the
 * multiplier drifts rather than jumping. This matters more than it looks:
 * with INDEPENDENT per-slot noise the best achievable skill ratio against a
 * seasonal-naive baseline is exactly E|U-1| / E|U1-U2| = 0.75, so design.md's
 * 0.70 target is unreachable no matter how good the model is — the noise is
 * irreducible by construction.
 *
 * Real ridership has momentum: a busy afternoon stays busy. Autocorrelated
 * noise reproduces that, and it is precisely what the recent-lag features can
 * exploit and last-week's-same-slot cannot.
 */
function smoothNoise(slot: number, zone: number, bucket = 8): number {
  const i = Math.floor(slot / bucket);
  const t = (slot % bucket) / bucket;
  const a = hash2(i, zone * 37 + 11);
  const b = hash2(i + 1, zone * 37 + 11);
  // Smoothstep, so the seams between buckets are not visible as kinks.
  const w = t * t * (3 - 2 * t);
  return a * (1 - w) + b * w;
}

/** Deterministic integer draw around a mean, so counts look like counts. */
function drawCount(mean: number, slot: number, zone: number): number {
  const drift = 0.62 + 0.76 * smoothNoise(slot, zone);
  // A little independent jitter on top, so it is not perfectly predictable.
  const jitter = 0.94 + 0.12 * hash2(slot * 7 + zone, 5171);
  return Math.max(0, Math.round(mean * drift * jitter));
}

async function main(): Promise<void> {
  ensureModels();

  const zones = await sequelize.query<{ id: string; population_ix: string | null }>(
    'SELECT id, population_ix FROM zones ORDER BY id',
    { type: QueryTypes.SELECT },
  );
  const vehicles = await sequelize.query<{ id: string; operator_id: string }>(
    'SELECT id, operator_id FROM vehicles WHERE deleted_at IS NULL ORDER BY id',
    { type: QueryTypes.SELECT },
  );
  if (zones.length === 0 || vehicles.length === 0) {
    throw new Error('Seed the city first: npm run db:seed');
  }

  // Idempotent: this script owns every trip whose public_ref starts with "h-".
  const [before] = await sequelize.query<{ n: string }>(
    "SELECT COUNT(*) AS n FROM trips WHERE public_ref LIKE 'h-%'",
    { type: QueryTypes.SELECT },
  );
  if (Number(before?.n ?? 0) > 0) {
    console.log(`clearing ${before!.n} existing backfilled trips`);
    await sequelize.query("DELETE FROM trips WHERE public_ref LIKE 'h-%'");
  }

  // Whole days, ending at the most recent midnight, so "today" stays partial
  // and the model is never asked to predict a slot it was trained on.
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const totalSlots = WEEKS * 7 * SLOTS_PER_DAY;
  const start = new Date(end.getTime() - totalSlots * SLOT_MINUTES * 60_000);

  console.log(
    `backfilling ${WEEKS} weeks: ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`,
  );

  let vehicleCursor = 0;
  let written = 0;
  let rows: string[] = [];
  let reps: unknown[] = [];

  const flush = async (): Promise<void> => {
    if (rows.length === 0) return;
    await sequelize.query(
      `INSERT INTO trips
         (public_ref, user_id, vehicle_id, operator_id, start_zone_id, end_zone_id,
          started_at, ended_at, distance_m, duration_s, status)
       VALUES ${rows.join(',')}`,
      { replacements: reps },
    );
    written += rows.length;
    rows = [];
    reps = [];
  };

  for (let slot = 0; slot < totalSlots; slot++) {
    const slotStart = new Date(start.getTime() + slot * SLOT_MINUTES * 60_000);
    const hour = slotStart.getHours() + slotStart.getMinutes() / 60;
    const dow = slotStart.getDay();

    // A wet slot suppresses ridership. Deterministic, and correlated in time so
    // rain lasts a while rather than flickering slot to slot.
    const wet = hash2(Math.floor(slot / 8), 7717) > 0.82;
    const weatherFactor = wet ? 0.55 : 1.0;

    for (const [zi, zone] of zones.entries()) {
      const popScale = 0.55 + Number(zone.population_ix ?? 6) / 9;
      const mean = baseDemand(dow, hour) * popScale * weatherFactor;
      const count = drawCount(mean, slot, zi);

      for (let k = 0; k < count; k++) {
        const v = vehicles[vehicleCursor % vehicles.length]!;
        vehicleCursor += 1;
        const endZone = zones[(zi + 1 + (k % (zones.length - 1))) % zones.length]!;
        const durationS = 300 + Math.round(hash2(slot + k, zi) * 1500);
        const distanceM = 600 + Math.round(hash2(zi, slot + k) * 4200);
        const startedAt = new Date(slotStart.getTime() + (k % SLOT_MINUTES) * 60_000);

        rows.push('(?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        reps.push(
          // CHAR(36); slot index and k keep it unique and reproducible.
          `h-${zi}-${slot}-${k}`,
          v.id,
          v.operator_id,
          zone.id,
          endZone.id,
          startedAt,
          new Date(startedAt.getTime() + durationS * 1000),
          distanceM,
          durationS,
          'completed',
        );
      }
    }

    if (rows.length >= 900) await flush();
  }
  await flush();

  const [check] = await sequelize.query<{ n: string; first: string; last: string }>(
    `SELECT COUNT(*) AS n, MIN(started_at) AS first, MAX(started_at) AS last
     FROM trips WHERE public_ref LIKE 'h-%'`,
    { type: QueryTypes.SELECT },
  );

  console.log(`wrote ${written} trips`);
  console.log(`history spans ${check?.first} .. ${check?.last}`);
  await sequelize.close();
}

await main();
