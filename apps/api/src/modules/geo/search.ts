import { QueryTypes } from 'sequelize';
import type { PlaceDto, PlaceKind } from '@mm/shared-types';
import { sequelize } from '../../db/index.ts';
import { parsePoint, selectGeom } from '../../db/spatial.ts';

/**
 * Place search, so a rider can choose where they are going by name instead of
 * hunting for it on the map.
 *
 * Searches what the system already knows the name of — localities, named
 * streets, rental and charging stations, and the rider's own saved places —
 * rather than calling an external geocoder. Every result is guaranteed to be
 * inside the routable city, which a geocoder's result is not.
 */

interface PlaceRow {
  id: string;
  kind: PlaceKind;
  name: string;
  context: string | null;
  wkt: string | null;
}

/** Order results so the rider's own places and stations outrank a side street. */
const KIND_RANK: Record<PlaceKind, number> = {
  saved: 0,
  rental_station: 1,
  zone: 2,
  charging_station: 3,
  street: 4,
};

/** Escape LIKE wildcards so "50%" searches for a literal percent sign. */
function likeEscape(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function searchPlaces(userId: string, q: string, limit = 12): Promise<PlaceDto[]> {
  const term = q.trim();
  if (term.length === 0) return [];
  const like = `%${likeEscape(term)}%`;

  // A street is many segments; one point per name is enough to route to. The
  // start of its lowest-id segment is arbitrary but stable across calls.
  const rows = await sequelize.query<PlaceRow>(
    `SELECT CONCAT('saved:', sp.id) AS id, 'saved' AS kind, sp.label AS name,
            sp.address AS context, ${selectGeom('sp.position', 'wkt')}
       FROM saved_places sp
      WHERE sp.user_id = :user AND (sp.label LIKE :like OR sp.address LIKE :like)
     UNION ALL
     SELECT CONCAT('station:', rs.id), 'rental_station', rs.name, z.name,
            ${selectGeom('rs.location', 'wkt')}
       FROM rental_stations rs LEFT JOIN zones z ON z.id = rs.zone_id
      WHERE rs.deleted_at IS NULL AND rs.status = 'active' AND rs.name LIKE :like
     UNION ALL
     SELECT CONCAT('zone:', z.id), 'zone', z.name, 'Locality',
            ${selectGeom('z.centroid', 'wkt')}
       FROM zones z
      WHERE z.name LIKE :like
     UNION ALL
     SELECT CONCAT('charging:', cs.id), 'charging_station', cs.name, z.name,
            ${selectGeom('cs.location', 'wkt')}
       FROM charging_stations cs LEFT JOIN zones z ON z.id = cs.zone_id
      WHERE cs.deleted_at IS NULL AND cs.status = 'active' AND cs.name LIKE :like
     UNION ALL
     SELECT CONCAT('street:', r.id), 'street', r.name, z.name,
            ${selectGeom('ST_StartPoint(r.geometry)', 'wkt')}
       FROM road_segments r
       JOIN (SELECT MIN(id) AS id FROM road_segments
              WHERE name IS NOT NULL AND name LIKE :like GROUP BY name) first ON first.id = r.id
       LEFT JOIN zones z ON z.id = r.zone_id`,
    { replacements: { user: userId, like }, type: QueryTypes.SELECT },
  );

  const lower = term.toLowerCase();
  return rows
    .map((r) => {
      const p = parsePoint(r.wkt);
      return p
        ? ({
            id: r.id,
            kind: r.kind,
            name: r.name,
            context: r.context,
            location: p.coordinates,
          } as PlaceDto)
        : null;
    })
    .filter((p): p is PlaceDto => p !== null)
    .sort((a, b) => {
      // Names that start with what was typed come first, then by kind, then A–Z.
      const pa = a.name.toLowerCase().startsWith(lower) ? 0 : 1;
      const pb = b.name.toLowerCase().startsWith(lower) ? 0 : 1;
      return pa - pb || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}
