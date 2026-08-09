import NodeCache from 'node-cache';
import type { CacheDriver } from '../index.ts';

/**
 * In-process cache. Dies on restart, which is correct behaviour here — nothing
 * cached is a source of truth (design.md §10).
 */
export class MemoryCacheDriver implements CacheDriver {
  readonly #store: NodeCache;
  /**
   * In-flight producers, so N concurrent wrap() calls for the same cold key
   * run the producer once rather than N times. A single-process cache makes
   * this trivially correct; a Redis driver would need a real lock.
   */
  readonly #inflight = new Map<string, Promise<unknown>>();

  constructor() {
    this.#store = new NodeCache({ useClones: false, checkperiod: 60 });
  }

  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.#store.get<T>(key));
  }

  set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.#store.set(key, value, ttlSeconds);
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.#store.del(key);
    return Promise.resolve();
  }

  async wrap<T>(key: string, ttlSeconds: number, producer: () => Promise<T>): Promise<T> {
    const hit = this.#store.get<T>(key);
    if (hit !== undefined) return hit;

    const pending = this.#inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const promise = producer()
      .then((value) => {
        this.#store.set(key, value, ttlSeconds);
        return value;
      })
      .finally(() => {
        this.#inflight.delete(key);
      });

    this.#inflight.set(key, promise);
    return promise;
  }

  flush(): Promise<void> {
    this.#store.flushAll();
    this.#inflight.clear();
    return Promise.resolve();
  }
}
