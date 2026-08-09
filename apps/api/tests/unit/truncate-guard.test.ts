import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The truncate helper is the single most dangerous file in this repo: this
 * MySQL instance hosts ~15 unrelated project databases, and a helper pointed at
 * the wrong schema destroys someone else's work.
 *
 * These tests prove the guard refuses to load rather than trusting a comment.
 */
const ORIGINAL_TEST_DB = process.env.DB_NAME_TEST;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL_TEST_DB === undefined) delete process.env.DB_NAME_TEST;
  else process.env.DB_NAME_TEST = ORIGINAL_TEST_DB;
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  vi.resetModules();
});

describe('truncate guard', () => {
  it('refuses to load when the target schema is the DEV database', async () => {
    process.env.DB_NAME_TEST = 'micromobility';
    await expect(import('../helpers/db.ts')).rejects.toThrow(/does not end in _test/);
  });

  it('refuses to load when the target schema belongs to another project', async () => {
    process.env.DB_NAME_TEST = 'belgaum_matrimony';
    await expect(import('../helpers/db.ts')).rejects.toThrow(/does not end in _test/);
  });

  it('names the offending schema so the mistake is obvious', async () => {
    process.env.DB_NAME_TEST = 'personal_tracker';
    await expect(import('../helpers/db.ts')).rejects.toThrow(/personal_tracker/);
  });

  it('refuses to load when NODE_ENV is not test, because the app points at DEV', async () => {
    process.env.DB_NAME_TEST = 'micromobility_test';
    process.env.NODE_ENV = 'development';
    await expect(import('../helpers/db.ts')).rejects.toThrow(/Run tests with NODE_ENV=test/);
  });

  it('loads normally for a _test schema in test mode', async () => {
    process.env.DB_NAME_TEST = 'micromobility_test';
    process.env.NODE_ENV = 'test';
    const mod = await import('../helpers/db.ts');
    expect(mod.truncateAll).toBeTypeOf('function');
    await mod.testDb.close();
  });
});
