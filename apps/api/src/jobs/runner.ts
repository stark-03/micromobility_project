import crypto from 'node:crypto';
import { env } from '../config/env.ts';
import { InlineJobDriver } from './drivers/inline.ts';

/**
 * `enqueue(name, payload) → jobId` is deliberately the exact signature BullMQ
 * would need, so adding Redis later is a driver swap and nothing else
 * (CLAUDE.md, background jobs section).
 *
 * Sprint 1 has no long-running work. The seam ships now, with one trivial
 * registered job and a test, so Sprint 4's simulation runs attach to something
 * already proven rather than something invented under pressure.
 */
export type JobHandler = (payload: unknown) => Promise<void> | void;

export interface JobDriver {
  enqueue(name: string, payload: unknown, jobId: string): Promise<void>;
  shutdown(): Promise<void>;
}

const handlers = new Map<string, JobHandler>();

export function registerJob(name: string, handler: JobHandler): void {
  if (handlers.has(name)) throw new Error(`Job "${name}" is already registered`);
  handlers.set(name, handler);
}

export function getJobHandler(name: string): JobHandler | undefined {
  return handlers.get(name);
}

export function registeredJobNames(): string[] {
  return [...handlers.keys()];
}

function build(): JobDriver {
  switch (env.queueDriver) {
    case 'inline':
      return new InlineJobDriver();
    default:
      throw new Error(
        `Unknown QUEUE_DRIVER "${env.queueDriver}". Only "inline" exists in this build; ` +
          'BullMQ is a later sprint and adding it is a driver swap, not a code change.',
      );
  }
}

const driver = build();

export async function enqueue(name: string, payload: unknown): Promise<string> {
  if (!handlers.has(name)) {
    throw new Error(
      `No handler registered for job "${name}". Known jobs: ${registeredJobNames().join(', ') || 'none'}`,
    );
  }
  const jobId = crypto.randomUUID();
  await driver.enqueue(name, payload, jobId);
  return jobId;
}

export function shutdownJobs(): Promise<void> {
  return driver.shutdown();
}
