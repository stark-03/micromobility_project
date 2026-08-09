import { afterAll, beforeEach } from 'vitest';
import { testDb, truncateAll } from './db.ts';
import { seedReference } from './fixtures.ts';
import type { ReferenceIds } from './fixtures.ts';

/**
 * Opt-in test isolation for HTTP tests.
 *
 * Call once at the top of a test file:
 *
 *   const ref = useCleanDatabase();
 *   it('...', () => { ref.current.operatorIds[0] });
 *
 * Deliberately NOT a global setupFile. Not every integration test wants a wiped
 * schema — seed.test.ts seeds twice and compares row counts, and a global
 * beforeEach truncate would delete the very data it asserts on. Opting in per
 * file keeps the interaction visible at the point it matters.
 *
 * Isolation is truncate-and-reseed rather than transaction rollback because a
 * Supertest request crosses a real socket: the handler runs on a different pool
 * connection in a different async context, so a transaction opened in the test
 * body never encloses its writes. See docs/adr/0001-test-isolation.md.
 */
export function useCleanDatabase(): { current: ReferenceIds } {
  const holder = { current: undefined as unknown as ReferenceIds };

  beforeEach(async () => {
    await truncateAll();
    holder.current = await seedReference();
  });

  afterAll(async () => {
    await testDb.close();
  });

  return holder;
}
