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

/**
 * Belagavi is radial-concentric, like most Indian cities that grew outward from
 * a market centre: arterials radiate from the middle, ring roads cross them,
 * and local streets fill the sectors between.
 *
 * The first two attempts generated a lattice — then a jittered lattice — and
 * both read as a warped fishing net. Wobble does not help, because the problem
 * was topological, not cosmetic: a mesh has uniform degree-4 junctions
 * everywhere, and no city does.
 *
 * This builds the hierarchy explicitly:
 *   - one centre
 *   - SPOKES radial arterials running out from it
 *   - RING_RADII concentric ring roads crossing them, irregular rather than
 *     circular
 *   - short local streets filling sectors, denser near the middle
 *
 * Connectivity is structural: every radial touches the centre, every ring
 * touches every radial, and every local street attaches to nodes that already
 * exist. assertConnected proves it before anything is written.
 */

const CENTRE: LngLat = [
  (CITY_BBOX.minLng + CITY_BBOX.maxLng) / 2,
  (CITY_BBOX.minLat + CITY_BBOX.maxLat) / 2,
];

const SPOKES = 12;
/** Ring radii as a fraction of the city's half-height. */
const RING_RADII = [0.22, 0.42, 0.63, 0.86];

/** Degrees of latitude for one unit of radius. */
const R_LAT = (CITY_H / 2) * 1.02;
/**
 * Longitude is compressed by cos(latitude) on the ground, so a ring drawn with
 * equal degree offsets would render as an ellipse. Dividing by cos here means
 * the rings come out round once projected.
 */
const R_LNG = R_LAT / Math.cos((CENTRE[1] * Math.PI) / 180);

function ringNode(ring: number, spoke: number): LngLat {
  const theta = (spoke / SPOKES) * Math.PI * 2 + (hash2(ring + 11, spoke + 3) - 0.5) * 0.14;
  // Rings wobble in and out so they read as roads that grew, not as circles.
  const wobble = 1 + (hash2(spoke + 61, ring + 17) - 0.5) * 0.24;
  const r = RING_RADII[ring]! * wobble;
  return [
    Number((CENTRE[0] + Math.cos(theta) * r * R_LNG).toFixed(6)),
    Number((CENTRE[1] + Math.sin(theta) * r * R_LAT).toFixed(6)),
  ];
}

function nodeName(ring: number, spoke: number): string {
  return ring < 0 ? 'N-CENTRE' : `N-R${ring}-S${((spoke % SPOKES) + SPOKES) % SPOKES}`;
}

function nodePos(ring: number, spoke: number): LngLat {
  return ring < 0 ? CENTRE : ringNode(ring, spoke);
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

const RADIAL_NAMES = [
  'Khanapur Road', 'Pune-Bengaluru Bypass', 'Goa Road', 'Ramdurg Road',
  'Bauxite Road', 'Old PB Road', 'Vengurla Road', 'Mudalgi Road',
  'Hindwadi Main', 'Angol Main', 'Kanbargi Road', 'Auto Nagar Road',
];
const RING_NAMES = ['Inner Ring', 'Fort Ring', 'Outer Ring', 'Bypass Ring'];
const LOCAL_NAMES = [
  'Ramdev Galli', 'Kirloskar Road', 'College Road', 'Congress Road', 'RPD Cross',
  'Club Road', 'Shivaji Road', 'Market Lane', 'Station Cross', 'Tilak Galli',
];

export function buildSegments(): SegmentSeed[] {
  const segments: SegmentSeed[] = [];
  let i = 0;

  const push = (
    from: { ring: number; spoke: number },
    to: { ring: number; spoke: number },
    cls: RoadClass,
    name: string,
  ): void => {
    const a = nodePos(from.ring, from.spoke);
    const b = nodePos(to.ring, to.spoke);
    if (a[0] === b[0] && a[1] === b[1]) return;
    i += 1;

    // Ring roads curve around the centre; radials and locals take a slight
    // lateral bend. Either way, no street is a ruled line.
    const mid: LngLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const bowAmount = (hash2(i, 4441) - 0.5) * 0.28;
    const bend: LngLat = [
      Number((mid[0] + (-dy / len) * len * bowAmount).toFixed(6)),
      Number((mid[1] + (dx / len) * len * bowAmount).toFixed(6)),
    ];

    const geometry: LngLat[] = [a, bend, b];
    segments.push({
      externalRef: `SEG-${String(i).padStart(4, '0')}`,
      name,
      fromNode: nodeName(from.ring, from.spoke),
      toNode: nodeName(to.ring, to.spoke),
      geometry,
      lengthM: Number((haversineM(a, bend) + haversineM(bend, b)).toFixed(2)),
      speedFreeKph: SPEED_BY_CLASS[cls],
      lanes: cls === 'arterial' ? 3 : cls === 'collector' ? 2 : 1,
      oneWay: i % 11 === 0,
      gradientPct: Number((((i % 11) - 5) * 0.4).toFixed(2)),
      roadClass: cls,
      hasBikeLane: cls === 'cycleway' || i % 5 === 0,
      lit: i % 13 !== 0,
      zoneCode: zoneCodeFor(mid),
    });
  };

  // Radial arterials: centre outward through every ring.
  for (let s = 0; s < SPOKES; s++) {
    const name = RADIAL_NAMES[s % RADIAL_NAMES.length]!;
    push({ ring: -1, spoke: s }, { ring: 0, spoke: s }, 'arterial', name);
    for (let r = 0; r < RING_RADII.length - 1; r++) {
      // Not every radial reaches the edge — some peter out, as they do in life.
      if (r >= 2 && hash2(s + 91, r + 7) > 0.78) break;
      // Radials thin out as they leave the centre, like real through-routes.
      push(
        { ring: r, spoke: s },
        { ring: r + 1, spoke: s },
        r === 0 ? 'arterial' : r === 1 ? 'collector' : 'local',
        name,
      );
    }
  }

  // Ring roads: each closes a loop around the centre.
  for (let r = 0; r < RING_RADII.length; r++) {
    const name = RING_NAMES[r % RING_NAMES.length]!;
    // Only the outer bypass and one mid ring carry arterial traffic. Making
    // every ring an arterial put 45% of the network at the highest congestion
    // sensitivity, which rendered the whole city orange.
    const cls: RoadClass =
      r === RING_RADII.length - 1 ? 'arterial' : r === 2 ? 'arterial' : 'collector';
    for (let s = 0; s < SPOKES; s++) {
      push({ ring: r, spoke: s }, { ring: r, spoke: s + 1 }, cls, name);
    }
  }

  // Local streets: diagonal cut-throughs inside sectors, denser near the middle
  // where a real city is densest.
  for (let r = 0; r < RING_RADII.length - 1; r++) {
    // Denser local fabric: local streets are the majority of any real network,
    // and they are what give the congestion map its range of colour.
    const density = 0.95 - r * 0.08;
    for (let s = 0; s < SPOKES; s++) {
      if (hash2(r * 53 + 9, s * 29 + 4) < density) {
        push(
          { ring: r, spoke: s },
          { ring: r + 1, spoke: s + 1 },
          hash2(s, r) > 0.62 ? 'cycleway' : 'local',
          LOCAL_NAMES[(r * SPOKES + s) % LOCAL_NAMES.length]!,
        );
      }
      if (hash2(r * 71 + 13, s * 37 + 6) < density * 0.9) {
        push(
          { ring: r + 1, spoke: s },
          { ring: r, spoke: s + 1 },
          hash2(r, s) > 0.85 ? 'path' : 'local',
          LOCAL_NAMES[(r * SPOKES + s + 5) % LOCAL_NAMES.length]!,
        );
      }
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
