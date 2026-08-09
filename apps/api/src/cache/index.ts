import { env } from '../config/env.ts';
import { MemoryCacheDriver } from './drivers/memory.ts';

/**
 * The one seam every cache read and write goes through.
 *
 * No service may import node-cache (or, later, ioredis) directly — that is the
 * whole point. Switching CACHE_DRIVER to "redis" must be a one-file change.
 */
export interface CacheDriver {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Get-or-produce. The primary surface — prefer it over get/set pairs. */
  wrap<T>(key: string, ttlSeconds: number, producer: () => Promise<T>): Promise<T>;
  /** Test/maintenance only. */
  flush(): Promise<void>;
}

function build(): CacheDriver {
  switch (env.cacheDriver) {
    case 'memory':
      return new MemoryCacheDriver();
    default:
      throw new Error(
        `Unknown CACHE_DRIVER "${env.cacheDriver}". Only "memory" exists in this build; ` +
          'Redis is a later sprint and adding it is a driver swap, not a code change.',
      );
  }
}

export const cache: CacheDriver = build();
