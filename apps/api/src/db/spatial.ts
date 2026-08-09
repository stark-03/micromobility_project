import { Sequelize } from 'sequelize';
import type { Utils } from 'sequelize';
import type { GeoLineString, GeoPoint, GeoPolygon, LngLat } from '@mm/shared-types';

const SRID = 4326;
const AXIS = "'axis-order=long-lat'";

/**
 * MySQL 8 treats SRID 4326 as latitude-longitude. GeoJSON, MapLibre and deck.gl
 * all use longitude-latitude. Every read and write here passes
 * axis-order=long-lat so application code speaks [lng, lat] everywhere.
 *
 * This file is the ONLY place an ST_* function may appear. There is a
 * verification step in the plan that greps for exactly that.
 *
 * Coordinates are interpolated into the SQL string rather than bound as
 * parameters because MySQL will not accept a placeholder for the WKT argument
 * of ST_GeomFromText inside a Sequelize literal. Every number is checked with
 * Number.isFinite first, so nothing but a plain numeric literal can reach the
 * query — there is no string path an injection could travel.
 */

function escapeNum(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(`Non-finite coordinate: ${String(n)}`);
  }
  return String(n);
}

function pair(c: LngLat): string {
  return `${escapeNum(c[0])} ${escapeNum(c[1])}`;
}

export function pointLiteral(p: LngLat): Utils.Literal {
  return Sequelize.literal(`ST_GeomFromText('POINT(${pair(p)})', ${SRID}, ${AXIS})`);
}

export function lineStringLiteral(coords: LngLat[]): Utils.Literal {
  if (coords.length < 2) throw new Error('LINESTRING needs at least 2 coordinates');
  return Sequelize.literal(
    `ST_GeomFromText('LINESTRING(${coords.map(pair).join(',')})', ${SRID}, ${AXIS})`,
  );
}

export function polygonLiteral(ring: LngLat[]): Utils.Literal {
  if (ring.length < 3) throw new Error('POLYGON ring needs at least 3 coordinates');
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  const closed = first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
  return Sequelize.literal(
    `ST_GeomFromText('POLYGON((${closed.map(pair).join(',')}))', ${SRID}, ${AXIS})`,
  );
}

/** SELECT fragment: `ST_AsText(col, 'axis-order=long-lat') AS alias` */
export function selectGeom(col: string, alias: string): string {
  return `ST_AsText(${col}, ${AXIS}) AS ${alias}`;
}

function coords(body: string): LngLat[] {
  return body.split(',').map((p) => {
    const parts = p.trim().split(/\s+/);
    const lng = Number(parts[0]);
    const lat = Number(parts[1]);
    if (parts.length !== 2 || Number.isNaN(lng) || Number.isNaN(lat)) {
      throw new Error(`Unparseable coordinate pair: "${p}"`);
    }
    return [lng, lat] as LngLat;
  });
}

export function parsePoint(wkt: string | null | undefined): GeoPoint | null {
  if (!wkt) return null;
  const m = /^POINT\((.+)\)$/.exec(wkt.trim());
  if (!m?.[1]) throw new Error(`Not a POINT: ${wkt}`);
  return { type: 'Point', coordinates: coords(m[1])[0]! };
}

export function parseLineString(wkt: string | null | undefined): GeoLineString | null {
  if (!wkt) return null;
  const m = /^LINESTRING\((.+)\)$/.exec(wkt.trim());
  if (!m?.[1]) throw new Error(`Not a LINESTRING: ${wkt}`);
  return { type: 'LineString', coordinates: coords(m[1]) };
}

export function parsePolygon(wkt: string | null | undefined): GeoPolygon | null {
  if (!wkt) return null;
  const m = /^POLYGON\(\((.+)\)\)$/.exec(wkt.trim());
  if (!m?.[1]) throw new Error(`Not a POLYGON: ${wkt}`);
  return { type: 'Polygon', coordinates: [coords(m[1])] };
}
