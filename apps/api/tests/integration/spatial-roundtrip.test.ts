import { afterAll, describe, expect, it } from 'vitest';
import { QueryTypes } from 'sequelize';
import { env } from '../../src/config/env.ts';
import { buildSequelize } from '../../src/db/index.ts';
import { parsePoint, parsePolygon, pointLiteral, polygonLiteral, selectGeom } from '../../src/db/spatial.ts';

const s = buildSequelize(env.db.nameTest);
afterAll(async () => {
  await s.close();
});

describe('spatial round-trip through MySQL', () => {
  it('writes and reads a Belagavi point without transposing the axes', async () => {
    await s.query('DROP TABLE IF EXISTS _spatial_probe');
    await s.query(
      'CREATE TABLE _spatial_probe (id INT PRIMARY KEY, p POINT NOT NULL SRID 4326) ENGINE=InnoDB',
    );

    const lit = pointLiteral([74.4977, 15.8497]).val as string;
    await s.query(`INSERT INTO _spatial_probe (id, p) VALUES (1, ${lit})`);

    const rows = await s.query<{ wkt: string }>(
      `SELECT ${selectGeom('p', 'wkt')} FROM _spatial_probe WHERE id = 1`,
      { type: QueryTypes.SELECT },
    );
    const parsed = parsePoint(rows[0]!.wkt)!;

    // If the axis order were wrong this would come back as [15.8497, 74.4977],
    // which is a point in the Indian Ocean rather than Belagavi.
    expect(parsed.coordinates[0]).toBeCloseTo(74.4977, 4); // lng
    expect(parsed.coordinates[1]).toBeCloseTo(15.8497, 4); // lat

    await s.query('DROP TABLE _spatial_probe');
  });

  it('round-trips a polygon ring in the same order it was written', async () => {
    await s.query('DROP TABLE IF EXISTS _spatial_probe_poly');
    await s.query(
      'CREATE TABLE _spatial_probe_poly (id INT PRIMARY KEY, b POLYGON NOT NULL SRID 4326) ENGINE=InnoDB',
    );

    const ring: [number, number][] = [
      [74.49, 15.84],
      [74.51, 15.84],
      [74.51, 15.86],
      [74.49, 15.86],
    ];
    const lit = polygonLiteral(ring).val as string;
    await s.query(`INSERT INTO _spatial_probe_poly (id, b) VALUES (1, ${lit})`);

    const rows = await s.query<{ wkt: string }>(
      `SELECT ${selectGeom('b', 'wkt')} FROM _spatial_probe_poly WHERE id = 1`,
      { type: QueryTypes.SELECT },
    );
    const parsed = parsePolygon(rows[0]!.wkt)!;

    expect(parsed.coordinates[0]).toHaveLength(5); // 4 corners + closing point
    expect(parsed.coordinates[0]![0]![0]).toBeCloseTo(74.49, 4); // lng first
    expect(parsed.coordinates[0]![0]![1]).toBeCloseTo(15.84, 4); // lat second

    await s.query('DROP TABLE _spatial_probe_poly');
  });

  it('MySQL agrees the point is inside the polygon — proves both use one frame', async () => {
    // `inside` arrives as the string "1", not the number 1: dialectOptions sets
    // bigNumberStrings so BIGINT ids survive as strings. Coerce at the boundary,
    // which is the same rule DTO mappers follow for DECIMAL columns.
    const [row] = await s.query<{ inside: string }>(
      `SELECT ST_Contains(
         ${(polygonLiteral([
           [74.49, 15.84],
           [74.51, 15.84],
           [74.51, 15.86],
           [74.49, 15.86],
         ]).val as string)},
         ${(pointLiteral([74.4977, 15.8497]).val as string)}
       ) AS inside`,
      { type: QueryTypes.SELECT },
    );
    expect(Number(row!.inside)).toBe(1);
  });
});
