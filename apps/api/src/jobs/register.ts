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

  registerJob('echo', async (payload) => {
    const { outFile, value } = payload as { outFile?: string; value?: unknown };
    if (outFile) await fs.writeFile(outFile, JSON.stringify({ value }), 'utf8');
  });
}
