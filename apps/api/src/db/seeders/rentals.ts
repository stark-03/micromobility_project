import { QueryTypes } from 'sequelize';
import type { Sequelize, Transaction } from 'sequelize';
import type { LngLat } from '@mm/shared-types';
import { haversineM } from '../../lib/geo.ts';
import { pointLiteral } from '../spatial.ts';
import { ZONES } from './belagavi-geo.ts';

/**
 * M08 rental stations, and docking the seeded fleet into them.
 *
 * One hub per locality plus four at the city's busiest landmarks — the same
 * landmarks the charging seed uses. Capacities differ so that the demo has a
 * station that is nearly full (a return gets refused) and edge stations that
 * run short (the recommender has to suggest an alternative).
 */
const LANDMARKS: Array<{ code: string; name: string; at: LngLat; capacity: number }> = [
  { code: 'RS-CBS', name: 'Central Bus Stand', at: [74.4995, 15.8562], capacity: 20 },
  { code: 'RS-RLY', name: 'Belagavi Railway Station', at: [74.5041, 15.8321], capacity: 16 },
  { code: 'RS-FORT', name: 'Fort Road', at: [74.4968, 15.8517], capacity: 10 },
  { code: 'RS-CAMP', name: 'Camp Market', at: [74.5108, 15.8607], capacity: 6 },
];

/** How far a seeded vehicle may be from a station and still be docked there. */
const DOCK_RADIUS_M = 900;

/** Statuses that sit in a dock. In-use, returning and retired vehicles do not. */
const DOCKABLE = ['available', 'charging', 'maintenance', 'reserved'];

export function stationSeeds(): Array<{
  code: string;
  name: string;
  at: LngLat;
  capacity: number;
}> {
  return [
    ...ZONES.map((z) => ({
      code: `RS-${z.code}`,
      name: `${z.name} Hub`,
      at: z.centroid,
      capacity: 12,
    })),
    ...LANDMARKS,
  ];
}

export async function seedRentalStations(s: Sequelize, t: Transaction): Promise<number> {
  const seeds = stationSeeds();

  for (const st of seeds) {
    const point = pointLiteral(st.at).val as string;
    await s.query(
      `INSERT INTO rental_stations (code, name, zone_id, location, capacity)
       SELECT :code, :name,
              (SELECT id FROM zones WHERE ST_Contains(boundary, ${point}) LIMIT 1),
              ${point}, :capacity
       ON DUPLICATE KEY UPDATE name = :name, location = ${point}, capacity = :capacity`,
      { replacements: { code: st.code, name: st.name, capacity: st.capacity }, transaction: t },
    );
  }

  const stations = await s.query<{ id: string; code: string; capacity: number }>(
    'SELECT id, code, capacity FROM rental_stations WHERE code IN (:codes)',
    { replacements: { codes: seeds.map((x) => x.code) }, type: QueryTypes.SELECT, transaction: t },
  );
  const byCode = new Map(stations.map((r) => [r.code, r]));
  const sites = seeds.map((x) => ({ ...x, id: String(byCode.get(x.code)!.id), used: 0 }));

  // Dock every dockable vehicle at its nearest station with room, in id order,
  // so the result is the same on every run.
  const vehicles = await s.query<{ id: string; status: string; lng: number; lat: number }>(
    `SELECT id, status, ST_Longitude(last_position) AS lng, ST_Latitude(last_position) AS lat
       FROM vehicles
      WHERE deleted_at IS NULL AND last_position IS NOT NULL
      ORDER BY id`,
    { type: QueryTypes.SELECT, transaction: t },
  );

  let docked = 0;
  for (const [i, v] of vehicles.entries()) {
    if (!DOCKABLE.includes(v.status)) {
      await s.query('UPDATE vehicles SET station_id = NULL WHERE id = :id', {
        replacements: { id: v.id },
        transaction: t,
      });
      continue;
    }
    const here: LngLat = [Number(v.lng), Number(v.lat)];
    const site = sites
      .filter((x) => x.used < x.capacity - 1) // always leave a dock free for a return
      .map((x) => ({ x, d: haversineM(here, x.at) }))
      .filter(({ d }) => d <= DOCK_RADIUS_M)
      .sort((a, b) => a.d - b.d)[0]?.x;

    if (!site) {
      await s.query('UPDATE vehicles SET station_id = NULL WHERE id = :id', {
        replacements: { id: v.id },
        transaction: t,
      });
      continue;
    }

    site.used += 1;
    docked += 1;
    // Racked in a short row beside the station point, a few metres apart.
    const slot: LngLat = [
      Number((site.at[0] + ((i % 5) - 2) * 0.00004).toFixed(6)),
      Number((site.at[1] + (Math.floor(i / 5) % 3) * 0.00003).toFixed(6)),
    ];
    await s.query(
      `UPDATE vehicles SET station_id = :station, last_position = ${pointLiteral(slot).val as string}
        WHERE id = :id`,
      { replacements: { station: site.id, id: v.id }, transaction: t },
    );
  }

  return docked;
}
