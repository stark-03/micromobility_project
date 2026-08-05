import { describe, expect, it } from 'vitest';
import {
  lineStringLiteral,
  parseLineString,
  parsePoint,
  parsePolygon,
  pointLiteral,
  polygonLiteral,
  selectGeom,
} from '../../src/db/spatial.ts';

// Belagavi city centre, in [lng, lat] order as the whole app uses.
const BELAGAVI: [number, number] = [74.4977, 15.8497];

describe('spatial parsing', () => {
  it('parses a POINT into [lng, lat]', () => {
    expect(parsePoint('POINT(74.4977 15.8497)')).toEqual({
      type: 'Point',
      coordinates: BELAGAVI,
    });
  });

  it('returns null for null input', () => {
    expect(parsePoint(null)).toBeNull();
    expect(parseLineString(null)).toBeNull();
    expect(parsePolygon(null)).toBeNull();
  });

  it('parses a LINESTRING', () => {
    expect(parseLineString('LINESTRING(74.49 15.84,74.50 15.85)')).toEqual({
      type: 'LineString',
      coordinates: [
        [74.49, 15.84],
        [74.5, 15.85],
      ],
    });
  });

  it('parses a POLYGON ring', () => {
    const wkt = 'POLYGON((74.49 15.84,74.50 15.84,74.50 15.85,74.49 15.85,74.49 15.84))';
    const parsed = parsePolygon(wkt);
    expect(parsed?.type).toBe('Polygon');
    expect(parsed?.coordinates[0]).toHaveLength(5);
    expect(parsed?.coordinates[0]?.[0]).toEqual([74.49, 15.84]);
  });

  it('throws on a malformed WKT rather than returning nonsense', () => {
    expect(() => parsePoint('LINESTRING(1 2,3 4)')).toThrow(/Not a POINT/);
  });
});

describe('spatial literals', () => {
  it('emits axis-order=long-lat on every write', () => {
    expect(pointLiteral(BELAGAVI).val).toContain("'axis-order=long-lat'");
    expect(
      lineStringLiteral([
        [74.49, 15.84],
        [74.5, 15.85],
      ]).val,
    ).toContain("'axis-order=long-lat'");
  });

  it('writes coordinates in the order MySQL will read them back', () => {
    expect(pointLiteral(BELAGAVI).val).toBe(
      "ST_GeomFromText('POINT(74.4977 15.8497)', 4326, 'axis-order=long-lat')",
    );
  });

  it('closes an open polygon ring automatically', () => {
    const open: [number, number][] = [
      [74.49, 15.84],
      [74.5, 15.84],
      [74.5, 15.85],
    ];
    // 3 supplied points + the repeated first point = 4 pairs.
    expect(polygonLiteral(open).val).toBe(
      "ST_GeomFromText('POLYGON((74.49 15.84,74.5 15.84,74.5 15.85,74.49 15.84))', 4326, 'axis-order=long-lat')",
    );
  });

  it('does not double-close an already-closed ring', () => {
    const closed: [number, number][] = [
      [74.49, 15.84],
      [74.5, 15.84],
      [74.5, 15.85],
      [74.49, 15.84],
    ];
    // Exactly the 4 supplied points — the first is not appended a second time.
    expect(polygonLiteral(closed).val).toBe(
      "ST_GeomFromText('POLYGON((74.49 15.84,74.5 15.84,74.5 15.85,74.49 15.84))', 4326, 'axis-order=long-lat')",
    );
  });

  it('rejects a non-finite coordinate instead of writing NaN into the database', () => {
    expect(() => pointLiteral([Number.NaN, 15.84])).toThrow(/Non-finite/);
    expect(() => pointLiteral([74.49, Number.POSITIVE_INFINITY])).toThrow(/Non-finite/);
  });

  it('rejects degenerate geometries', () => {
    expect(() => lineStringLiteral([[74.49, 15.84]])).toThrow(/at least 2/);
    expect(() =>
      polygonLiteral([
        [74.49, 15.84],
        [74.5, 15.84],
      ]),
    ).toThrow(/at least 3/);
  });

  it('emits axis-order=long-lat on every read', () => {
    expect(selectGeom('centroid', 'wkt')).toBe(
      "ST_AsText(centroid, 'axis-order=long-lat') AS wkt",
    );
  });
});
