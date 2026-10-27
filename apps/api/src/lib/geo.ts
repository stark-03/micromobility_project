import type { LngLat } from '@mm/shared-types';

const R_EARTH_M = 6_371_008.8;

/**
 * Great-circle metres between two [lng, lat] points.
 *
 * The JS twin of MySQL's ST_Distance_Sphere, for distances computed between
 * points already in memory (GPS increments) where a round trip to the
 * database per point would be absurd.
 */
export function haversineM(a: LngLat, b: LngLat): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a path, in metres. */
export function pathLengthM(path: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineM(path[i - 1]!, path[i]!);
  return total;
}
