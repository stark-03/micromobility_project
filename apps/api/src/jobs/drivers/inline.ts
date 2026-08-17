import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { bus } from '../../realtime/bus.ts';
import { isJobBusMessage } from '../progress.ts';
import type { JobDriver } from '../runner.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(here, '../worker.ts');

/**
 * Runs each job on a worker_threads Worker, in this process.
 *
 * Long work is still async — it just is not distributed. `enqueue` resolves as
 * soon as the worker is spawned; the caller gets a jobId and, from Sprint 4,
 * polls the job's DB row or listens on the socket. It never assumes a queue.
 */
export class InlineJobDriver implements JobDriver {
  readonly #running = new Set<Worker>();

  enqueue(name: string, payload: unknown, jobId: string): Promise<void> {
    const worker = new Worker(workerPath, {
      workerData: { name, payload, jobId },
      // Node strips types in the worker too, but only when told the entry is TS.
      execArgv: ['--experimental-strip-types', '--no-warnings'],
    });

    this.#running.add(worker);

    // A worker's `bus` is a different EventEmitter than the gateway's — see
    // jobs/progress.ts. This is the one place the two are joined up.
    worker.on('message', (message: unknown) => {
      if (isJobBusMessage(message)) bus.emit(message.event, message.payload);
    });

    worker.on('error', (err) => {
      // A failed job must never take the API process down with it.
      console.error(`[jobs] job ${name} (${jobId}) failed:`, err);
    });
    worker.on('exit', () => {
      this.#running.delete(worker);
    });

    return Promise.resolve();
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.#running].map((w) => w.terminate()));
    this.#running.clear();
  }
}
