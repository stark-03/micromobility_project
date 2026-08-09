import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { registerJobs } from '../../src/jobs/register.ts';
import { enqueue, registeredJobNames, shutdownJobs } from '../../src/jobs/runner.ts';

registerJobs();

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-jobs-'));

afterAll(async () => {
  await shutdownJobs();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function waitForFile(file: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await fs.readFile(file, 'utf8');
    } catch {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${file}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

describe('job runner (inline driver)', () => {
  it('registers the Sprint 1 job catalogue', () => {
    expect(registeredJobNames()).toContain('echo');
  });

  it('returns a jobId immediately and runs the job on a worker thread', async () => {
    const outFile = path.join(tmpDir, 'echo.json');
    const jobId = await enqueue('echo', { outFile, value: { hello: 'belagavi' } });

    // The signature BullMQ would need: enqueue resolves with an id, not a result.
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);

    const written = await waitForFile(outFile);
    expect(JSON.parse(written)).toEqual({ value: { hello: 'belagavi' } });
  }, 20_000);

  it('gives each enqueue a distinct jobId', async () => {
    const a = await enqueue('echo', {});
    const b = await enqueue('echo', {});
    expect(a).not.toBe(b);
  }, 20_000);

  it('rejects an unregistered job by name, listing what is known', async () => {
    await expect(enqueue('does-not-exist', {})).rejects.toThrow(/No handler registered.*echo/s);
  });
});
