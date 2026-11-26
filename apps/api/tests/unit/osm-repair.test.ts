import { describe, expect, it } from 'vitest';
import type { LngLat } from '@mm/shared-types';
import type { OsmSegmentSeed } from '../../src/db/seeders/osm.ts';
import { repairDroppedLinks } from '../../src/db/seeders/osm-repair.ts';
import { assertConnected } from '../../src/db/seeders/graph.ts';

function seg(ref: string, from: string, to: string, a: LngLat, b: LngLat, oneWay = false): OsmSegmentSeed {
  return {
    externalRef: ref,
    name: 'Test Road',
    fromNode: from,
    toNode: to,
    geometry: [a, b],
    lengthM: 100,
    speedFreeKph: 30,
    lanes: 1,
    oneWay,
    gradientPct: 0,
    roadClass: 'local',
    hasBikeLane: false,
    lit: true,
  };
}

// ~1 m of latitude is 0.000009 degrees.
const A: LngLat = [74.5, 15.85];
const B: LngLat = [74.501, 15.85];
const C: LngLat = [74.50103, 15.85]; // ~3 m past B
const D: LngLat = [74.502, 15.85];

describe('repairDroppedLinks', () => {
  it('rebuilds a short piece dropped from the middle of a road, exactly', () => {
    const out = repairDroppedLinks([
      seg('OSM-7-0', 'n1', 'n2', A, B),
      seg('OSM-7-2', 'n3', 'n4', C, D),
    ]);
    const bridge = out.find((s) => s.externalRef === 'OSM-7-0-BRIDGE');
    expect(bridge).toMatchObject({ fromNode: 'n2', toNode: 'n3', name: 'Test Road' });
    expect(bridge!.lengthM).toBeGreaterThan(2);
    expect(bridge!.lengthM).toBeLessThan(5);
    expect(() => assertConnected(out.map((s) => [s.fromNode, s.toNode]))).not.toThrow();
  });

  it('reconnects a dead end a few metres from another road, keeping one-way direction', () => {
    const out = repairDroppedLinks([
      seg('OSM-1-0', 'n1', 'n2', A, B, true),
      seg('OSM-2-0', 'm1', 'm2', C, D),
    ]);
    const bridges = out.filter((s) => s.externalRef.includes('BRIDGE'));
    expect(bridges).toHaveLength(1);
    // The one-way road ended at n2; its dropped end led out of it, to m1.
    expect(bridges[0]).toMatchObject({ fromNode: 'n2', toNode: 'm1', oneWay: true });
  });

  it('leaves real gaps alone, and is safe to run twice', () => {
    const far: LngLat = [74.51, 15.85];
    const input = [seg('OSM-1-0', 'n1', 'n2', A, B), seg('OSM-2-0', 'm1', 'm2', far, D)];
    const once = repairDroppedLinks(input);
    expect(once).toHaveLength(2);

    const gap = [seg('OSM-7-0', 'n1', 'n2', A, B), seg('OSM-7-2', 'n3', 'n4', C, D)];
    const first = repairDroppedLinks(gap);
    expect(repairDroppedLinks(first)).toEqual(first);
  });
});
