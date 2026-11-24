import { QueryTypes } from 'sequelize';
import type { Sequelize, Transaction } from 'sequelize';
import { pointLiteral } from '../spatial.ts';
import type { LngLat } from '@mm/shared-types';

/**
 * Charging stations across Belagavi, at real places.
 *
 * Each point is OpenStreetMap's own position for the named place (Nominatim,
 * 2026-11-23). The first version's hand-typed positions were up to 3 km out, so
 * "Central Bus Stand" sat nowhere near the bus stand on the map underneath.
 * `formerly` lists the old names, so a re-seed moves those rows rather than
 * leaving them in the wrong place.
 *
 * Deliberately NOT spread evenly: the residential edges are thin, which is the
 * same shortfall the simulator surfaces as `battery` unmet demand.
 */
const STATIONS: Array<{ name: string; formerly?: string; at: LngLat; connectors: number; kw: number }> = [
  { name: 'Central Bus Stand', at: [74.52024, 15.86159], connectors: 8, kw: 7.4 },
  { name: 'Belagavi Railway Station', at: [74.50894, 15.84906], connectors: 6, kw: 7.4 },
  { name: 'Camp Church Park', formerly: 'Camp Market', at: [74.5006, 15.85541], connectors: 4, kw: 3.3 },
  { name: 'Tilakwadi', formerly: 'Tilakwadi Circle', at: [74.50193, 15.83686], connectors: 4, kw: 3.3 },
  { name: 'Shahapur', formerly: 'Shahapur Main Road', at: [74.51777, 15.84007], connectors: 4, kw: 3.3 },
  { name: 'Belgaum Fort', formerly: 'Fort Road', at: [74.52416, 15.85839], connectors: 3, kw: 3.3 },
  { name: 'Hindwadi Road', formerly: 'Hindwadi Junction', at: [74.51826, 15.83436], connectors: 3, kw: 3.3 },
  { name: 'Sadashiv Nagar', at: [74.50848, 15.8783], connectors: 2, kw: 3.3 },
];

/** Puts the seeded stations that already exist at their real positions. */
async function correctSeededStations(s: Sequelize, t: Transaction): Promise<void> {
  for (const st of STATIONS) {
    const point = pointLiteral(st.at).val as string;
    await s.query(
      `UPDATE charging_stations
          SET name = :name, location = ${point},
              zone_id = (SELECT id FROM zones WHERE ST_Contains(boundary, ${point}) LIMIT 1)
        WHERE name IN (:names) AND deleted_at IS NULL`,
      {
        replacements: { name: st.name, names: [st.name, st.formerly ?? st.name] },
        transaction: t,
      },
    );
  }
}

export async function seedChargingStations(s: Sequelize, t: Transaction): Promise<number> {
  const existing = await s.query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM charging_stations',
    { type: QueryTypes.SELECT, plain: true, transaction: t },
  );
  // Idempotent: a planner's own stations must survive a re-seed. Seeded ones
  // are moved to their real positions; nothing else is touched.
  if ((existing?.n ?? 0) > 0) {
    await correctSeededStations(s, t);
    return 0;
  }

  const [admin] = await s.query<{ id: string }>(
    `SELECT id FROM users WHERE email = 'admin@belagavi.local' LIMIT 1`,
    { type: QueryTypes.SELECT, transaction: t },
  );

  for (const st of STATIONS) {
    await s.query(
      `INSERT INTO charging_stations (name, zone_id, location, connectors, power_kw, status, created_by)
       SELECT :name,
              (SELECT id FROM zones WHERE ST_Contains(boundary, ${pointLiteral(st.at).val}) LIMIT 1),
              ${pointLiteral(st.at).val}, :connectors, :kw, 'active', :user`,
      {
        replacements: { name: st.name, connectors: st.connectors, kw: st.kw, user: admin?.id ?? null },
        transaction: t,
      },
    );
  }

  return STATIONS.length;
}
