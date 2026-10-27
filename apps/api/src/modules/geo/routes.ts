import { Router } from 'express';
import { QueryTypes } from 'sequelize';
import type { ZoneDto } from '@mm/shared-types';
import { sequelize } from '../../db/index.ts';
import { parsePoint, parsePolygon, selectGeom } from '../../db/spatial.ts';
import { ok } from '../../lib/envelope.ts';
import { requireAuth } from '../../middleware/auth.ts';
import { asyncHandler } from '../../middleware/error.ts';
import { query, validate } from '../../middleware/validate.ts';
import { z } from 'zod';
import { searchPlaces } from './search.ts';

export const geoRoutes = Router();

interface ZoneRow {
  id: string;
  code: string;
  name: string;
  population_ix: string | null;
  centroid_wkt: string | null;
  boundary_wkt: string | null;
}

/**
 * Zone geography. Reference data that barely changes, so it is cached hard on
 * the client — the map needs it on every load and it is the same for everyone.
 */
geoRoutes.get(
  '/zones',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const rows = await sequelize.query<ZoneRow>(
      `SELECT id, code, name, population_ix,
              ${selectGeom('centroid', 'centroid_wkt')},
              ${selectGeom('boundary', 'boundary_wkt')}
       FROM zones ORDER BY code`,
      { type: QueryTypes.SELECT },
    );

    const zones: ZoneDto[] = rows.map((r) => {
      const centroid = parsePoint(r.centroid_wkt);
      if (!centroid) throw new Error(`Zone ${r.code} has no centroid`);
      return {
        id: String(r.id),
        code: r.code,
        name: r.name,
        centroid,
        boundary: parsePolygon(r.boundary_wkt),
        populationIx: r.population_ix === null ? null : Number(r.population_ix),
      };
    });

    res.json(ok(zones));
  }),
);

/** Find a place by name — localities, streets, stations and the rider's saved places. */
geoRoutes.get(
  '/search',
  requireAuth,
  validate({
    query: z.object({
      q: z.string().trim().min(2).max(80),
      limit: z.coerce.number().int().min(1).max(30).default(12),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { q, limit } = query<{ q: string; limit: number }>(req);
    res.json(ok(await searchPlaces(req.user!.id, q, limit)));
  }),
);
