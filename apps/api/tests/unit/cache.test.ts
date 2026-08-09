import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cache } from '../../src/cache/index.ts';
import { CACHE_KEYS } from '../../src/cache/keys.ts';

describe('cache', () => {
  beforeEach(async () => {
    await cache.flush();
  });

  it('returns undefined for a missing key', async () => {
    expect(await cache.get('k')).toBeUndefined();
  });

  it('round-trips a value', async () => {
    await cache.set('k', { a: 1 }, 30);
    expect(await cache.get('k')).toEqual({ a: 1 });
  });

  it('deletes a key', async () => {
    await cache.set('k', 'v', 30);
    await cache.del('k');
    expect(await cache.get('k')).toBeUndefined();
  });

  it('wrap() calls the producer once and caches the result', async () => {
    const fn = vi.fn().mockResolvedValue('v');
    expect(await cache.wrap('k', 30, fn)).toBe('v');
    expect(await cache.wrap('k', 30, fn)).toBe('v');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('wrap() collapses concurrent misses into one producer call', async () => {
    let calls = 0;
    const slow = async (): Promise<string> => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return 'v';
    };

    const results = await Promise.all([
      cache.wrap('k', 30, slow),
      cache.wrap('k', 30, slow),
      cache.wrap('k', 30, slow),
    ]);

    expect(results).toEqual(['v', 'v', 'v']);
    // Without single-flight this would be 3 — and in M02 that means 3
    // simultaneous aggregations over traffic_readings.
    expect(calls).toBe(1);
  });

  it('wrap() does not cache a rejected producer', async () => {
    const boom = vi.fn().mockRejectedValue(new Error('nope'));
    await expect(cache.wrap('k', 30, boom)).rejects.toThrow('nope');

    const ok = vi.fn().mockResolvedValue('v');
    expect(await cache.wrap('k', 30, ok)).toBe('v');
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('expires a key after its TTL', async () => {
    await cache.set('k', 'v', 1);
    expect(await cache.get('k')).toBe('v');
    await new Promise((r) => setTimeout(r, 1100));
    expect(await cache.get('k')).toBeUndefined();
  });
});

describe('cache keys', () => {
  it('declares the vehicle list key with the TTL from CLAUDE.md', () => {
    expect(CACHE_KEYS.vehicleList('abc')).toEqual({ key: 'vehicles:list:abc', ttl: 15 });
  });
});
