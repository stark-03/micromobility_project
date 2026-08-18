import { rollupRecent } from '../src/modules/analytics/rollups.ts';

/**
 * Backfills the analytics rollups.
 *
 *   npm run rollup            # last 45 days
 *   npm run rollup -- 90
 *
 * The nightly job does two days; this exists for a fresh database, where six
 * weeks of seeded history would otherwise show up as an empty dashboard.
 */
const days = Number(process.argv[2] ?? 45);
const result = await rollupRecent(Number.isFinite(days) ? days : 45);
console.log(`rolled up ${result.days} days, ${result.trips} trips`);
process.exit(0);
