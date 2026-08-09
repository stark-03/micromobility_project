import { workerData } from 'node:worker_threads';
import { registerJobs } from './register.ts';
import { getJobHandler } from './runner.ts';

/**
 * Worker thread entrypoint. A worker starts with a fresh module registry, so it
 * must register the job catalogue itself — it cannot see the parent's.
 */
interface WorkerPayload {
  name: string;
  payload: unknown;
  jobId: string;
}

const { name, payload, jobId } = workerData as WorkerPayload;

registerJobs();

const handler = getJobHandler(name);
if (!handler) {
  throw new Error(`Worker started for unknown job "${name}" (${jobId})`);
}

await handler(payload);
