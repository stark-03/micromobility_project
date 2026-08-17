import { workerData } from 'node:worker_threads';
import { ensureModels } from '../db/models/index.ts';
import { registerJobs } from './register.ts';
import { getJobHandler } from './runner.ts';

/**
 * Worker thread entrypoint. A worker starts with a fresh module registry, so it
 * must register the job catalogue itself — it cannot see the parent's.
 *
 * The same applies to Sequelize models, and that one is easy to miss: only
 * `app.ts` calls `ensureModels`, and a worker never loads `app.ts`. A job using
 * a model then fails deep inside Sequelize with "Cannot read properties of
 * undefined (reading 'constructor')" — which names neither the model nor the
 * missing init. Jobs that only ran raw SQL never noticed.
 */
interface WorkerPayload {
  name: string;
  payload: unknown;
  jobId: string;
}

const { name, payload, jobId } = workerData as WorkerPayload;

ensureModels();
registerJobs();

const handler = getJobHandler(name);
if (!handler) {
  throw new Error(`Worker started for unknown job "${name}" (${jobId})`);
}

await handler(payload);
