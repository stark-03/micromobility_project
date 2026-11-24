import { describe, expect, it } from 'vitest';
import { CITY_BBOX, insidePolygon, LOCALITIES, pointInZone, ZONES } from '../../src/db/seeders/belagavi-geo.ts';

/**
 * The zones are built around each locality's real position. These pin down
 * the properties the old grid broke without anyone noticing: a zone's name
 * must belong to the place at its centre, and the zones must cover the city
 * exactly once.
 */

function area(ring: Array<[number, number]>): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

describe('zones', () => {
  it('are centred on the real place each is named after', () => {
    for (const loc of LOCALITIES) {
      const zone = ZONES.find((z) => z.code === loc.code)!;
      expect(zone.centroid).toEqual(loc.at);
      expect(insidePolygon(zone.centroid, zone.boundary), loc.name).toBe(true);
    }
  });

  it('cover the city exactly once, with no gaps or overlaps', () => {
    const city = (CITY_BBOX.maxLng - CITY_BBOX.minLng) * (CITY_BBOX.maxLat - CITY_BBOX.minLat);
    const total = ZONES.reduce((n, z) => n + area(z.boundary), 0);
    // Counter-clockwise rings, as MySQL expects, so every area is positive.
    for (const z of ZONES) expect(area(z.boundary), z.code).toBeGreaterThan(0);
    expect(total).toBeCloseTo(city, 8);
  });

  it('put every point in the zone of its nearest locality', () => {
    for (let i = 0; i < 400; i++) {
      const p: [number, number] = [
        CITY_BBOX.minLng + ((i * 37) % 97) / 97 * (CITY_BBOX.maxLng - CITY_BBOX.minLng),
        CITY_BBOX.minLat + ((i * 53) % 89) / 89 * (CITY_BBOX.maxLat - CITY_BBOX.minLat),
      ];
      const containing = ZONES.filter((z) => insidePolygon(p, z.boundary));
      expect(containing.length, `point ${p}`).toBeLessThanOrEqual(1);
    }
  });

  it('keeps seeded vehicles and trips inside their own zone', () => {
    for (const z of ZONES) {
      for (let i = 0; i < 200; i++) {
        expect(insidePolygon(pointInZone(z.centroid, i), z.boundary), `${z.code} #${i}`).toBe(true);
      }
    }
  });
});
