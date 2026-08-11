import type { LngLat, RoadClass } from '@mm/shared-types';

/**
 * Synthetic Belagavi, anchored on real locality names and approximate real
 * centroids (design.md §11 open question 1 — the ingest contract is identical
 * whether the data is real or generated).
 *
 * Everything here is DETERMINISTIC. No Math.random() anywhere: re-running the
 * seed must produce byte-identical geometry, or idempotency is a lie.
 * Coordinates are [lng, lat] throughout, as everywhere else in the app.
 *
 * The street network is a jittered lattice rather than a clean grid. A perfect
 * lattice is trivially connected and easy to reason about, but it renders as an
 * obvious test pattern — no city has kilometre-long dead-straight parallels.
 * Displacing each junction by a deterministic offset gives the network the
 * irregularity of a real place while keeping the graph provably connected.
 */

// ---- city extent -----------------------------------------------------------
// Belagavi's built-up area, roughly. Everything else is derived from this, so
// zones and roads share one frame and cannot drift apart.

export const CITY_BBOX = {
  minLng: 74.468,
  maxLng: 74.532,
  minLat: 15.808,
  maxLat: 15.882,
};

const CITY_W = CITY_BBOX.maxLng - CITY_BBOX.minLng;
const CITY_H = CITY_BBOX.maxLat - CITY_BBOX.minLat;

/**
 * Deterministic pseudo-random in [0,1) from two integers.
 *
 * A hash, not an RNG: the same (a,b) always yields the same value, in any
 * process, in any order. That is what lets the jitter be irregular AND the
 * seed be idempotent at the same time.
 */
function hash2(a: number, b: number): number {
  let h = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---- zones -----------------------------------------------------------------

export interface ZoneSeed {
  code: string;
  name: string;
  centroid: LngLat;
  populationIx: number;
  /** Tile corners, in [lng, lat]. */
  boundary: LngLat[];
}

/** Real localities with their approximate real positions, used for placement. */
const LOCALITIES = [
  { code: 'SDN', name: 'Sadashiv Nagar', at: [74.495, 15.87] as LngLat, populationIx: 5.1 },
  { code: 'CMP', name: 'Camp', at: [74.51, 15.86] as LngLat, populationIx: 7.1 },
  { code: 'HND', name: 'Hindwadi', at: [74.52, 15.855] as LngLat, populationIx: 6.9 },
  { code: 'SHP', name: 'Shahapur', at: [74.49, 15.848] as LngLat, populationIx: 9.2 },
  { code: 'TLK', name: 'Tilakwadi', at: [74.506, 15.8395] as LngLat, populationIx: 8.4 },
  { code: 'ANG', name: 'Angol', at: [74.515, 15.835] as LngLat, populationIx: 6.6 },
  { code: 'VDG', name: 'Vadgaon', at: [74.485, 15.83] as LngLat, populationIx: 6.3 },
  { code: 'UDY', name: 'Udyambag', at: [74.475, 15.82] as LngLat, populationIx: 5.8 },
];

const ZONE_COLS = 4;
const ZONE_ROWS = 2;

/**
 * Zones TILE the city rather than floating as scattered boxes.
 *
 * The first version placed a fixed-size square around each real centroid, which
 * left gaps, overlaps, and rectangles sitting at odd angles to the street grid —
 * it looked like an accident. A partition covers the map exactly once and reads
 * as administrative wards, which is what zones actually are.
 *
 * Each tile keeps a real locality name, assigned by which locality's true
 * position falls nearest that tile, so the geography stays broadly honest:
 * Sadashiv Nagar lands north, Udyambag south-west.
 */
export const ZONES: ZoneSeed[] = (() => {
  const tileW = CITY_W / ZONE_COLS;
  const tileH = CITY_H / ZONE_ROWS;

  const tiles: Array<{ centre: LngLat; boundary: LngLat[] }> = [];
  for (let r = 0; r < ZONE_ROWS; r++) {
    for (let c = 0; c < ZONE_COLS; c++) {
      const lng0 = CITY_BBOX.minLng + c * tileW;
      const lat0 = CITY_BBOX.minLat + r * tileH;
      const lng1 = lng0 + tileW;
      const lat1 = lat0 + tileH;
      tiles.push({
        centre: [Number((lng0 + tileW / 2).toFixed(6)), Number((lat0 + tileH / 2).toFixed(6))],
        boundary: [
          [Number(lng0.toFixed(6)), Number(lat0.toFixed(6))],
          [Number(lng1.toFixed(6)), Number(lat0.toFixed(6))],
          [Number(lng1.toFixed(6)), Number(lat1.toFixed(6))],
          [Number(lng0.toFixed(6)), Number(lat1.toFixed(6))],
        ],
      });
    }
  }

  // Greedy nearest assignment: each locality claims the free tile closest to
  // its real position. Deterministic because LOCALITIES is a fixed order.
  const taken = new Set<number>();
  return LOCALITIES.map((loc) => {
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    tiles.forEach((t, i) => {
      if (taken.has(i)) return;
      const d = (t.centre[0] - loc.at[0]) ** 2 + (t.centre[1] - loc.at[1]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    taken.add(best);
    const tile = tiles[best]!;
    return {
      code: loc.code,
      name: loc.name,
      centroid: tile.centre,
      populationIx: loc.populationIx,
      boundary: tile.boundary,
    };
  });
})();

export function zoneBoundary(_centroid: LngLat): LngLat[] {
  // Kept for the seeder's call signature; boundaries are now precomputed above.
  return [];
}

// ---- road graph ------------------------------------------------------------

export interface SegmentSeed {
  externalRef: string;
  name: string;
  fromNode: string;
  toNode: string;
  geometry: LngLat[];
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

const COLS = 11;
const ROWS = 7;

/** How far a junction may wander from its lattice position, as a cell fraction. */
const JITTER = 0.38;

function nodeName(row: number, col: number): string {
  return `N-${row}-${col}`;
}

function nodePos(row: number, col: number): LngLat {
  const cellW = CITY_W / (COLS - 1);
  const cellH = CITY_H / (ROWS - 1);

  const baseLng = CITY_BBOX.minLng + cellW * col;
  const baseLat = CITY_BBOX.minLat + cellH * row;

  // Edge junctions stay put, so the city keeps a clean outline instead of a
  // ragged fringe.
  const onEdge = row === 0 || col === 0 || row === ROWS - 1 || col === COLS - 1;
  const amount = onEdge ? JITTER * 0.25 : JITTER;

  const dLng = (hash2(row, col) - 0.5) * cellW * amount;
  const dLat = (hash2(col + 977, row + 331) - 0.5) * cellH * amount;

  return [Number((baseLng + dLng).toFixed(6)), Number((baseLat + dLat).toFixed(6))];
}

const R_EARTH_M = 6_371_000;

export function haversineM(a: LngLat, b: LngLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(h));
}

const SPEED_BY_CLASS: Record<RoadClass, number> = {
  arterial: 50,
  collector: 40,
  local: 30,
  path: 15,
  cycleway: 20,
};

function zoneCodeFor(p: LngLat): string {
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
  'Club Road',
  'Shivaji Road',
];

/**
 * Every horizontal and vertical neighbour pair becomes a street, plus a small
 * number of SHORT diagonal links between adjacent junctions.
 *
 * The earlier version drew diagonals between distant lattice points, which
 * rendered as long straight slashes across the whole city — the single most
 * artificial thing on the map. Diagonals now span one cell only, like a real
 * cut-through.
 *
 * The full lattice is connected by construction; assertConnected proves it
 * rather than assuming it.
 */
export function buildSegments(): SegmentSeed[] {
  const segments: SegmentSeed[] = [];
  let i = 0;

  const push = (r1: number, c1: number, r2: number, c2: number, cls: RoadClass): void => {
    const a = nodePos(r1, c1);
    const b = nodePos(r2, c2);
    const mid: LngLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    i += 1;

    // A slight bend at the midpoint. Two-point streets read as ruler-drawn;
    // three points is enough to suggest a road that follows terrain.
    const bendLng = (hash2(i, 7919) - 0.5) * (b[0] - a[0] === 0 ? CITY_W / COLS : 0) * 0.22;
    const bendLat = (hash2(7919, i) - 0.5) * (b[1] - a[1] === 0 ? CITY_H / ROWS : 0) * 0.22;
    const bend: LngLat = [
      Number((mid[0] + bendLng).toFixed(6)),
      Number((mid[1] + bendLat).toFixed(6)),
    ];

    const geometry: LngLat[] = [a, bend, b];
    const lengthM = haversineM(a, bend) + haversineM(bend, b);

    segments.push({
      externalRef: `SEG-${String(i).padStart(4, '0')}`,
      name: `${STREET_NAMES[i % STREET_NAMES.length]!} ${r1}-${c1}`,
      fromNode: nodeName(r1, c1),
      toNode: nodeName(r2, c2),
      geometry,
      lengthM: Number(lengthM.toFixed(2)),
      speedFreeKph: SPEED_BY_CLASS[cls],
      lanes: (i % 3) + 1,
      oneWay: i % 7 === 0,
      gradientPct: Number((((i % 11) - 5) * 0.4).toFixed(2)),
      roadClass: cls,
      hasBikeLane: i % 4 === 0,
      lit: i % 9 !== 0,
      zoneCode: zoneCodeFor(mid),
    });
  };

  // Arterials run along a few whole rows and columns, the way a real city has
  // a handful of through-routes rather than uniformly important streets.
  const arterialRows = new Set([1, 4]);
  const arterialCols = new Set([2, 7]);

  const classForH = (r: number, c: number): RoadClass => {
    if (arterialRows.has(r)) return 'arterial';
    if ((r + c) % 9 === 0) return 'cycleway';
    if ((r + c) % 5 === 0) return 'collector';
    return 'local';
  };
  const classForV = (r: number, c: number): RoadClass => {
    if (arterialCols.has(c)) return 'arterial';
    if ((r + c) % 8 === 0) return 'path';
    if ((r + c) % 5 === 0) return 'collector';
    return 'local';
  };

  // Horizontal: ROWS * (COLS - 1) = 7 * 10 = 70
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS - 1; c++) push(r, c, r, c + 1, classForH(r, c));
  }
  // Vertical: (ROWS - 1) * COLS = 6 * 11 = 66
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS; c++) push(r, c, r + 1, c, classForV(r, c));
  }
  // Short cut-throughs, one cell each, scattered deterministically.
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      if (hash2(r * 31 + 5, c * 17 + 3) > 0.87) push(r, c, r + 1, c + 1, 'cycleway');
    }
  }

  return segments;
}

/** Deterministic point inside a zone tile, indexed so repeat runs match. */
export function pointInZone(centroid: LngLat, index: number): LngLat {
  const halfW = CITY_W / ZONE_COLS / 2;
  const halfH = CITY_H / ZONE_ROWS / 2;
  const jLng = (hash2(index, 4211) - 0.5) * halfW * 1.6;
  const jLat = (hash2(4211, index) - 0.5) * halfH * 1.6;
  return [Number((centroid[0] + jLng).toFixed(6)), Number((centroid[1] + jLat).toFixed(6))];
}
