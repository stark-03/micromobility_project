import type { LngLat, RoadClass } from '@mm/shared-types';

/**
 * Synthetic Belagavi, anchored on real locality names and approximate real
 * centroids (design.md §11 open question 1 — the ingest contract is identical
 * whether the data is real or generated).
 *
 * Everything here is DETERMINISTIC. No Math.random() anywhere: re-running the
 * seed must produce byte-identical geometry, or idempotency is a lie.
 * Coordinates are [lng, lat] throughout, as everywhere else in the app.
 */

export interface ZoneSeed {
  code: string;
  name: string;
  centroid: LngLat;
  populationIx: number;
}

export const ZONES: ZoneSeed[] = [
  { code: 'TLK', name: 'Tilakwadi', centroid: [74.506, 15.8395], populationIx: 8.4 },
  { code: 'CMP', name: 'Camp', centroid: [74.51, 15.86], populationIx: 7.1 },
  { code: 'SHP', name: 'Shahapur', centroid: [74.49, 15.848], populationIx: 9.2 },
  { code: 'VDG', name: 'Vadgaon', centroid: [74.485, 15.83], populationIx: 6.3 },
  { code: 'UDY', name: 'Udyambag', centroid: [74.475, 15.82], populationIx: 5.8 },
  { code: 'HND', name: 'Hindwadi', centroid: [74.52, 15.855], populationIx: 6.9 },
  { code: 'SDN', name: 'Sadashiv Nagar', centroid: [74.495, 15.87], populationIx: 5.1 },
  { code: 'ANG', name: 'Angol', centroid: [74.515, 15.835], populationIx: 6.6 },
];

/** ~900 m half-width box around a centroid. */
const HALF = 0.008;

export function zoneBoundary(c: LngLat): LngLat[] {
  const [lng, lat] = c;
  return [
    [lng - HALF, lat - HALF],
    [lng + HALF, lat - HALF],
    [lng + HALF, lat + HALF],
    [lng - HALF, lat + HALF],
  ];
}

// ---- road graph ------------------------------------------------------------

export interface SegmentSeed {
  externalRef: string;
  name: string;
  fromNode: string;
  toNode: string;
  geometry: [LngLat, LngLat];
  lengthM: number;
  speedFreeKph: number;
  lanes: number;
  oneWay: boolean;
  gradientPct: number;
  roadClass: RoadClass;
  hasBikeLane: boolean;
  lit: boolean;
  zoneCode: string;
}

/** Lattice spanning the union bbox of all zones. 11 x 6 => 115 edges. */
const COLS = 11;
const ROWS = 6;

const BBOX = (() => {
  const lngs = ZONES.map((z) => z.centroid[0]);
  const lats = ZONES.map((z) => z.centroid[1]);
  return {
    minLng: Math.min(...lngs) - HALF,
    maxLng: Math.max(...lngs) + HALF,
    minLat: Math.min(...lats) - HALF,
    maxLat: Math.max(...lats) + HALF,
  };
})();

function nodeName(row: number, col: number): string {
  return `N-${row}-${col}`;
}

function nodePos(row: number, col: number): LngLat {
  const lng = BBOX.minLng + ((BBOX.maxLng - BBOX.minLng) * col) / (COLS - 1);
  const lat = BBOX.minLat + ((BBOX.maxLat - BBOX.minLat) * row) / (ROWS - 1);
  // Round to 6dp so the generated WKT is stable across runs.
  return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
}

const R_EARTH_M = 6_371_000;

export function haversineM(a: LngLat, b: LngLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(h));
}

const SPEED_BY_CLASS: Record<RoadClass, number> = {
  arterial: 50,
  collector: 40,
  local: 30,
  path: 15,
  cycleway: 20,
};

/** Nearest zone centroid to a point — assigns a segment to a zone. */
function nearestZoneCode(p: LngLat): string {
  let best = ZONES[0]!;
  let bestD = Number.POSITIVE_INFINITY;
  for (const z of ZONES) {
    const d = (z.centroid[0] - p[0]) ** 2 + (z.centroid[1] - p[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best.code;
}

const STREET_NAMES = [
  'Khanapur Road',
  'College Road',
  'Congress Road',
  'RPD Cross',
  'Ramdev Galli',
  'Kirloskar Road',
  'Mahantesh Nagar Link',
  'Ashok Nagar Road',
  'Auto Nagar Road',
  'Goa Road',
  'Pune-Bengaluru Bypass',
  'Club Road',
];

/**
 * Full lattice: every horizontal and vertical neighbour pair becomes a segment.
 * Connected by construction — assertConnected proves it rather than assuming it.
 */
export function buildSegments(): SegmentSeed[] {
  const segments: SegmentSeed[] = [];
  let i = 0;

  const push = (r1: number, c1: number, r2: number, c2: number, cls: RoadClass): void => {
    const a = nodePos(r1, c1);
    const b = nodePos(r2, c2);
    const mid: LngLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    i += 1;
    segments.push({
      externalRef: `SEG-${String(i).padStart(4, '0')}`,
      name: `${STREET_NAMES[i % STREET_NAMES.length]!} ${r1}-${c1}`,
      fromNode: nodeName(r1, c1),
      toNode: nodeName(r2, c2),
      geometry: [a, b],
      lengthM: Number(haversineM(a, b).toFixed(2)),
      speedFreeKph: SPEED_BY_CLASS[cls],
      // Deterministic per-index variation — no RNG.
      lanes: (i % 3) + 1,
      oneWay: i % 7 === 0,
      gradientPct: Number((((i % 11) - 5) * 0.4).toFixed(2)),
      roadClass: cls,
      hasBikeLane: i % 4 === 0,
      lit: i % 9 !== 0,
      zoneCode: nearestZoneCode(mid),
    });
  };

  const classFor = (n: number): RoadClass => {
    if (n % 10 === 0) return 'arterial';
    if (n % 5 === 0) return 'collector';
    if (n % 8 === 0) return 'cycleway';
    if (n % 13 === 0) return 'path';
    return 'local';
  };

  // Horizontal edges: ROWS * (COLS - 1) = 6 * 10 = 60
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS - 1; c++) push(r, c, r, c + 1, classFor(r * COLS + c));
  }
  // Vertical edges: (ROWS - 1) * COLS = 5 * 11 = 55
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS; c++) push(r, c, r + 1, c, classFor(r * COLS + c + 3));
  }
  // A few diagonal shortcuts to take the count past 120 and give A* real choices.
  for (let k = 0; k < 6; k++) push(k % (ROWS - 1), k, (k % (ROWS - 1)) + 1, k + 1, 'cycleway');

  return segments;
}

/** Deterministic point inside a zone box, indexed so repeat runs match. */
export function pointInZone(centroid: LngLat, index: number): LngLat {
  const jitterLng = ((((index * 37) % 100) - 50) / 50) * HALF * 0.8;
  const jitterLat = ((((index * 53) % 100) - 50) / 50) * HALF * 0.8;
  return [
    Number((centroid[0] + jitterLng).toFixed(6)),
    Number((centroid[1] + jitterLat).toFixed(6)),
  ];
}
