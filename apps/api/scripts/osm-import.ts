import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertConnected } from '../src/db/seeders/graph.ts';
import { CITY_BBOX } from '../src/db/seeders/belagavi-geo.ts';
import type { RoadClass } from '@mm/shared-types';

/**
 * Imports the real Belagavi street network from OpenStreetMap.
 *
 * The generated radial-concentric network was defensible on its own, but it
 * cannot sit under a real basemap: synthetic roads do not follow real streets,
 * and the mismatch is the first thing anyone notices. This replaces it with
 * actual OSM geometry, so the overlay and the tiles are the same city.
 *
 * The result is cached to a JSON fixture and committed, so seeding works
 * offline afterwards and a demo never depends on Overpass being up.
 *
 *   npm run osm:import            # use the cached fixture
 *   npm run osm:import -- --fetch # re-fetch from Overpass, then cache
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, '../src/db/seeders/belagavi-osm.json');

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const QUERY = `
[out:json][timeout:120];
(
  way["highway"~"^(primary|secondary|tertiary|residential|trunk|unclassified|living_street|cycleway)$"]
     (${CITY_BBOX.minLat},${CITY_BBOX.minLng},${CITY_BBOX.maxLat},${CITY_BBOX.maxLng});
);
out geom;
`;

interface OsmWay {
  id: number;
  nodes: number[];
  geometry?: Array<{ lat: number; lon: number }>;
  tags?: Record<string, string>;
}

/** OSM highway classes mapped onto the five this project models. */
const CLASS_MAP: Record<string, RoadClass> = {
  trunk: 'arterial',
  primary: 'arterial',
  secondary: 'collector',
  tertiary: 'collector',
  unclassified: 'local',
  residential: 'local',
  living_street: 'local',
  cycleway: 'cycleway',
  footway: 'path',
  path: 'path',
};

const SPEED_BY_CLASS: Record<RoadClass, number> = {
  arterial: 50,
  collector: 40,
  local: 30,
  path: 15,
  cycleway: 20,
};

export interface OsmSegment {
  externalRef: string;
  name: string | null;
  fromNode: string;
  toNode: string;
  geometry: [number, number][];
  lengthM: number;
  speedFreeKph: number;
  lanes: number;
  oneWay: boolean;
  gradientPct: number;
  roadClass: RoadClass;
  hasBikeLane: boolean;
  lit: boolean;
}

const R_EARTH_M = 6_371_000;

function haversineM(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(h));
}

/** Deterministic pseudo-random, so re-importing gives identical attributes. */
function hash(n: number): number {
  let h = Math.imul(n, 374761393);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

async function fetchOverpass(): Promise<OsmWay[]> {
  console.log('fetching from Overpass…');
  const res = await fetch(OVERPASS, {
    method: 'POST',
    // Overpass answers 406 without an explicit form content type, and rate
    // limits anonymous clients that do not identify themselves.
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'ai-urban-micromobility-simulator/0.1 (college project)',
    },
    body: new URLSearchParams({ data: QUERY }).toString(),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`Overpass returned ${res.status}`);
  const body = (await res.json()) as { elements: OsmWay[] };
  return body.elements;
}

/**
 * Splits OSM ways into routable edges.
 *
 * An OSM way is a stretch of road, not a graph edge: it can run through a dozen
 * junctions without breaking. Routing over unsplit ways would make every
 * intersection invisible — a router could only turn where a mapper happened to
 * end a way. So any interior node shared by two ways becomes a split point.
 */
function buildSegments(ways: OsmWay[]): OsmSegment[] {
  const usage = new Map<number, number>();
  for (const w of ways) {
    for (const n of w.nodes ?? []) usage.set(n, (usage.get(n) ?? 0) + 1);
  }

  const segments: OsmSegment[] = [];

  for (const w of ways) {
    const geom = w.geometry;
    const nodes = w.nodes;
    if (!geom || !nodes || geom.length < 2 || geom.length !== nodes.length) continue;

    const tags = w.tags ?? {};
    const roadClass = CLASS_MAP[tags.highway ?? ''] ?? 'local';
    const oneWay = tags.oneway === 'yes' || tags.oneway === '1' || tags.junction === 'roundabout';
    const lanes = Number(tags.lanes) || (roadClass === 'arterial' ? 2 : 1);
    const maxspeed = Number((tags.maxspeed ?? '').replace(/\D/g, ''));
    const speed = maxspeed > 0 ? maxspeed : SPEED_BY_CLASS[roadClass];
    const name = tags.name ?? null;
    const hasBikeLane =
      roadClass === 'cycleway' || Boolean(tags.cycleway) || tags['cycleway:both'] === 'lane';
    const lit = tags.lit === 'yes' || roadClass === 'arterial' || roadClass === 'collector';

    // Cut the way wherever an interior node is shared with another way.
    let cut = 0;
    for (let i = 1; i < nodes.length; i++) {
      const isJunction = (usage.get(nodes[i]!) ?? 0) > 1;
      const isEnd = i === nodes.length - 1;
      if (!isJunction && !isEnd) continue;

      const slice = geom.slice(cut, i + 1);
      if (slice.length < 2) {
        cut = i;
        continue;
      }

      const coords: [number, number][] = slice.map((p) => [
        Number(p.lon.toFixed(6)),
        Number(p.lat.toFixed(6)),
      ]);

      let lengthM = 0;
      for (let k = 1; k < coords.length; k++) lengthM += haversineM(coords[k - 1]!, coords[k]!);
      if (lengthM < 5) {
        cut = i;
        continue;
      }

      segments.push({
        externalRef: `OSM-${w.id}-${cut}`,
        name,
        fromNode: `N${nodes[cut]}`,
        toNode: `N${nodes[i]}`,
        geometry: coords,
        lengthM: Number(lengthM.toFixed(2)),
        speedFreeKph: speed,
        lanes: Math.min(6, Math.max(1, lanes)),
        oneWay,
        // OSM has no elevation here; a deterministic mild gradient keeps the
        // greenest routing profile meaningful. Real terrain is a later import.
        gradientPct: Number((((hash(w.id + cut) - 0.5) * 6).toFixed(2))),
        roadClass,
        hasBikeLane,
        lit,
      });
      cut = i;
    }
  }

  return segments;
}

/** Largest connected component, so A* can always find a route. */
function largestComponent(segments: OsmSegment[]): OsmSegment[] {
  const adjacency = new Map<string, string[]>();
  for (const s of segments) {
    (adjacency.get(s.fromNode) ?? adjacency.set(s.fromNode, []).get(s.fromNode)!).push(s.toNode);
    (adjacency.get(s.toNode) ?? adjacency.set(s.toNode, []).get(s.toNode)!).push(s.fromNode);
  }

  const seen = new Set<string>();
  let best = new Set<string>();

  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;
    const component = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (component.has(node)) continue;
      component.add(node);
      seen.add(node);
      for (const next of adjacency.get(node) ?? []) {
        if (!component.has(next)) stack.push(next);
      }
    }
    if (component.size > best.size) best = component;
  }

  return segments.filter((s) => best.has(s.fromNode) && best.has(s.toNode));
}

async function main(): Promise<void> {
  const shouldFetch = process.argv.includes('--fetch');

  const rawPath = path.join(here, '../../../.osm-raw.json');

  let ways: OsmWay[];
  if (shouldFetch) {
    // A previously downloaded response beats hammering a free public API.
    try {
      const raw = JSON.parse(await fs.readFile(rawPath, 'utf8')) as { elements: OsmWay[] };
      ways = raw.elements;
      console.log(`using cached Overpass response (${ways.length} ways)`);
    } catch {
      ways = await fetchOverpass();
      await fs.writeFile(rawPath, JSON.stringify({ elements: ways }));
    }
  } else {
    try {
      const cached = JSON.parse(await fs.readFile(FIXTURE, 'utf8')) as { segments: OsmSegment[] };
      console.log(`cached fixture already present: ${cached.segments.length} segments`);
      console.log('pass --fetch to rebuild it from Overpass');
      return;
    } catch {
      ways = await fetchOverpass();
    }
  }

  console.log(`${ways.length} ways`);
  const all = buildSegments(ways);
  console.log(`${all.length} segments after splitting at junctions`);

  const connected = largestComponent(all);
  console.log(
    `${connected.length} in the largest connected component ` +
      `(${all.length - connected.length} dropped as unreachable)`,
  );

  assertConnected(connected.map((s) => [s.fromNode, s.toNode] as [string, string]));

  const named = connected.filter((s) => s.name).length;
  console.log(`${named} carry a real street name`);

  await fs.writeFile(
    FIXTURE,
    JSON.stringify({ source: 'OpenStreetMap via Overpass', bbox: CITY_BBOX, segments: connected }),
  );
  console.log(`cached to ${path.relative(process.cwd(), FIXTURE)}`);
}

await main();
