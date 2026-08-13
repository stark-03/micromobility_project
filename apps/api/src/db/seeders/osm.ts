import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LngLat, RoadClass } from '@mm/shared-types';

/**
 * The real Belagavi street network, imported from OpenStreetMap.
 *
 * Committed as a fixture rather than fetched at seed time: a demo must not
 * depend on Overpass being up, and pinning the file means the seeded city is
 * identical on every machine. Rebuild with `npm run osm:import -- --fetch`.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

export interface OsmSegmentSeed {
  externalRef: string;
  name: string | null;
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
  zoneCode?: string;
}

let cache: OsmSegmentSeed[] | null = null;

export function loadOsmSegments(): OsmSegmentSeed[] {
  if (cache) return cache;
  const file = path.join(here, 'belagavi-osm.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { segments: OsmSegmentSeed[] };
  cache = parsed.segments;
  return cache;
}

/**
 * Which roads carry traffic sensors.
 *
 * Arterials and collectors only — 1,736 of 9,212. Instrumenting every
 * residential lane is neither realistic nor useful: real traffic services show
 * congestion on main corridors and leave side streets uncoloured, and writing a
 * reading per side street every few seconds would swamp the database for no
 * demonstrable gain.
 */
export function isMonitored(roadClass: RoadClass): boolean {
  return roadClass === 'arterial' || roadClass === 'collector';
}
