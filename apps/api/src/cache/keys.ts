/**
 * Every cache key and TTL is declared here and nowhere else. A key invented at
 * a call site is a key nobody can find when it needs invalidating.
 *
 * TTLs come from CLAUDE.md's cache section. Later sprints add:
 *   traffic:snapshot:<zoneId>  15 s   (Sprint 2, M02)
 *   route:<hash>               60 s   (Sprint 3, M04)
 *   kpi:<scope>:<day>         600 s   (Sprint 5, M11)
 */
export interface CacheKeySpec {
  key: string;
  ttl: number;
}

export const CACHE_KEYS = {
  /** A page of the vehicle list, keyed by a hash of its filter params. */
  vehicleList: (hash: string): CacheKeySpec => ({ key: `vehicles:list:${hash}`, ttl: 15 }),
} as const;
