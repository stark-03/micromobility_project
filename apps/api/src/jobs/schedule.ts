import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';
import { rebuildSnapshots } from '../modules/traffic/service.ts';
import { pollWeather } from '../modules/weather/service.ts';
import { ensurePartitions } from './partitions.ts';

/**
 * Scheduled work, per CLAUDE.md: node-cron inside the API process. No external
 * scheduler, because there is no external anything — this is a single-process
 * deployment by design.
 *
 * Every task is wrapped so a thrown error logs and the schedule survives.
 * A cron job that kills the API at 02:00 is worse than one that skips a run.
 */
const tasks: ScheduledTask[] = [];

function safely(name: string, fn: () => Promise<unknown>): () => void {
  return () => {
    void fn().catch((e: unknown) => {
      logger.error('scheduled job failed', {
        job: name,
        error: e instanceof Error ? e.message : String(e),
      });
    });
  };
}

export function startSchedule(): void {
  // Tests drive these directly; a cron firing mid-test would fight the
  // truncate-and-reseed harness.
  if (env.isTest) return;

  // Traffic snapshot — every minute (CLAUDE.md).
  tasks.push(
    cron.schedule(
      '* * * * *',
      safely('traffic-snapshot', async () => {
        const r = await rebuildSnapshots(120);
        logger.debug('traffic snapshot rebuilt', { ...r });
      }),
    ),
  );

  // Weather poll — every 15 minutes (MODULES.md M12).
  tasks.push(
    cron.schedule(
      '*/15 * * * *',
      safely('weather-poll', async () => {
        const r = await pollWeather();
        logger.debug('weather polled', { ...r });
      }),
    ),
  );

  // Partition maintenance — 02:15 on the 1st. Provisions months ahead, so a
  // single missed run is harmless.
  tasks.push(
    cron.schedule(
      '15 2 1 * *',
      safely('partition-maintenance', async () => {
        const r = await ensurePartitions();
        logger.info('partition maintenance complete', { results: r });
      }),
    ),
  );

  logger.info('scheduled jobs started', { count: tasks.length });
}

export async function stopSchedule(): Promise<void> {
  await Promise.all(tasks.map((t) => t.destroy()));
  tasks.length = 0;
}
