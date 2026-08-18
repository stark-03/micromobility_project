import fs from 'node:fs/promises';
import { registerJob, registeredJobNames } from './runner.ts';

/**
 * The job catalogue. Called by the API on boot and by every worker thread,
 * which starts with its own empty module registry.
 *
 * Sprint 1 registers only `echo`, which exists to prove the seam works before
 * Sprint 4's simulation runs depend on it. Later sprints add: nightly rollups,
 * partition maintenance, model training, simulation runs.
 */
export function registerJobs(): void {
  if (registeredJobNames().length > 0) return;

  // M05: training is a job, never a request handler. Six weeks of history is
  // far more than an HTTP timeout allows.
  registerJob('train-demand', async () => {
    const { trainDemandModel } = await import('../modules/predictions/service.ts');
    await trainDemandModel();
  });

  // M06: a simulation run is a background job by contract (MODULES.md), not
  // because it is slow. The engine finishes a 24-hour city in well under a
  // second, but the interface is what a distributed queue will need later.
  registerJob('run-simulation', async (payload) => {
    const { runId } = payload as { runId: string };
    const { executeRun } = await import('../modules/simulation/service.ts');
    await executeRun(runId);
  });

  // M11/M10: the nightly rollup. The ONLY writer of kpi_daily and
  // zone_daily_rollups, and the only place trips are scanned in bulk.
  registerJob('rollup-daily', async (payload) => {
    const { days } = (payload ?? {}) as { days?: number };
    const { rollupRecent } = await import('../modules/analytics/rollups.ts');
    await rollupRecent(days ?? 2);
  });

  registerJob('echo', async (payload) => {
    const { outFile, value } = payload as { outFile?: string; value?: unknown };
    if (outFile) await fs.writeFile(outFile, JSON.stringify({ value }), 'utf8');
  });
}
