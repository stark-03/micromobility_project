import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // MUST be at the root, not inside a project: this is a runner-level option
    // and Vitest ignores it in a project block. Integration tests share one
    // MySQL schema and truncate between tests, so concurrent files wipe each
    // other's rows mid-test — which surfaces as InnoDB deadlocks and phantom
    // "row not found" failures rather than anything that names the real cause.
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'web',
          root: './apps/web',
          environment: 'jsdom',
          include: ['tests/**/*.test.{ts,tsx}'],
          setupFiles: ['./tests/setup.ts'],
        },
      },
      {
        test: {
          name: 'api',
          root: './apps/api',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
