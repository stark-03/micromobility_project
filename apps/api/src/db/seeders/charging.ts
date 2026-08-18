import { QueryTypes } from 'sequelize';
import type { Sequelize, Transaction } from 'sequelize';
import { pointLiteral } from '../spatial.ts';
import type { LngLat } from '@mm/shared-types';

/**
 * Charging stations across Belagavi.
 *
 * Placed at real landmarks rather than on a grid, and deliberately NOT spread
 * evenly: the residential edges are thin, which is the same shortfall the
 * simulator surfaces as `battery` unmet demand. A planner using the map to add
 * one where it is missing is the intended demo.
 */
const STATIONS: Array<{ name: string; at: LngLat; connectors: number; kw: number }> = [
  { name: 'Central Bus Stand', at: [74.4995, 15.8562], connectors: 8, kw: 7.4 },
  { name: 'Belagavi Railway Station', at: [74.5041, 15.8321], connectors: 6, kw: 7.4 },
  { name: 'Camp Market', at: [74.5108, 15.8607], connectors: 4, kw: 3.3 },
  { name: 'Tilakwadi Circle', at: [74.5062, 15.8398], connectors: 4, kw: 3.3 },
  { name: 'Shahapur Main Road', at: [74.4903, 15.8481], connectors: 4, kw: 3.3 },
  { name: 'Fort Road', at: [74.4968, 15.8517], connectors: 3, kw: 3.3 },
  { name: 'Hindwadi Junction', at: [74.5215, 15.8551], connectors: 3, kw: 3.3 },
  { name: 'Sadashiv Nagar', at: [74.4948, 15.8698], connectors: 2, kw: 3.3 },
];

export async function seedChargingStations(s: Sequelize, t: Transaction): Promise<number> {
  const existing = await s.query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM charging_stations',
    { type: QueryTypes.SELECT, plain: true, transaction: t },
  );
  // Idempotent: a planner's own stations must survive a re-seed.
  if ((existing?.n ?? 0) > 0) return 0;

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
