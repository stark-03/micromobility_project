import { QueryTypes } from 'sequelize';
import { sequelize } from '../db/index.ts';
import { logger } from '../lib/logger.ts';

/**
 * Monthly partition maintenance for the two high-volume tables.
 *
 * Both are RANGE partitioned by month with a `pmax` catch-all. Left alone,
 * every new month lands in pmax, which grows without bound and cannot be
 * dropped without taking the recent data with it.
 *
 * MySQL will not let you ADD a partition below MAXVALUE, so extending the
 * range means REORGANIZE pmax into [new month, ..., pmax]. That rewrites only
 * pmax, which is empty in normal operation, so it is cheap.
 */
const PARTITIONED_TABLES = [
  // The partitioning column is noted for readers; REORGANIZE does not name it.
  { table: 'traffic_readings' /* observed_at */ },
  { table: 'vehicle_telemetry' /* recorded_at */ },
] as const;

/** How many months ahead to keep provisioned. */
const MONTHS_AHEAD = 3;

function partitionName(d: Date): string {
  return `p${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** First day of the month after `d`, as YYYY-MM-DD. */
function firstOfNextMonth(d: Date): string {
  const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return n.toISOString().slice(0, 10);
}

export interface PartitionResult {
  table: string;
  added: string[];
}

export async function ensurePartitions(now = new Date()): Promise<PartitionResult[]> {
  const results: PartitionResult[] = [];

  for (const { table } of PARTITIONED_TABLES) {
    const existing = await sequelize.query<{ PARTITION_NAME: string }>(
      `SELECT PARTITION_NAME FROM information_schema.PARTITIONS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND PARTITION_NAME IS NOT NULL`,
      { type: QueryTypes.SELECT, replacements: [table] },
    );
    const have = new Set(existing.map((r) => r.PARTITION_NAME));
    if (have.size === 0) {
      logger.warn('partition maintenance skipped: table not partitioned', { table });
      continue;
    }

    const missing: Array<{ name: string; lessThan: string }> = [];
    for (let i = 0; i <= MONTHS_AHEAD; i++) {
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      const name = partitionName(month);
      if (!have.has(name)) missing.push({ name, lessThan: firstOfNextMonth(month) });
    }

    if (missing.length === 0) {
      results.push({ table, added: [] });
      continue;
    }

    const clauses = missing
      .map((m) => `PARTITION ${m.name} VALUES LESS THAN (TO_DAYS('${m.lessThan}'))`)
      .join(',\n        ');

    await sequelize.query(
      `ALTER TABLE \`${table}\` REORGANIZE PARTITION pmax INTO (
        ${clauses},
        PARTITION pmax VALUES LESS THAN MAXVALUE
      )`,
    );

    logger.info('partitions added', { table, added: missing.map((m) => m.name) });
    results.push({ table, added: missing.map((m) => m.name) });
  }

  return results;
}

/**
 * Drops partitions older than `keepMonths`. Not scheduled by default — data
 * retention is a policy decision, not something a cron job should assume.
 */
export async function dropPartitionsOlderThan(
  keepMonths: number,
  now = new Date(),
): Promise<string[]> {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - keepMonths, 1));
  const dropped: string[] = [];

  for (const { table } of PARTITIONED_TABLES) {
    const existing = await sequelize.query<{ PARTITION_NAME: string }>(
      `SELECT PARTITION_NAME FROM information_schema.PARTITIONS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND PARTITION_NAME IS NOT NULL`,
      { type: QueryTypes.SELECT, replacements: [table] },
    );

    for (const { PARTITION_NAME: name } of existing) {
      const m = /^p(\d{4})_(\d{2})$/.exec(name);
      if (!m) continue; // never touch pmax
      const partitionMonth = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
      if (partitionMonth < cutoff) {
        await sequelize.query(`ALTER TABLE \`${table}\` DROP PARTITION ${name}`);
        dropped.push(`${table}.${name}`);
      }
    }
  }

  if (dropped.length > 0) logger.info('partitions dropped', { dropped });
  return dropped;
}
