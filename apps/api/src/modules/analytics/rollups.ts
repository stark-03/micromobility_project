import { QueryTypes } from 'sequelize';
import { sequelize } from '../../db/index.ts';
import { logger } from '../../lib/logger.ts';

/**
 * M11 / M10 — the nightly rollup.
 *
 * CLAUDE.md forbids aggregating raw data at request time, so this is the only
 * place trips are scanned. It is idempotent per day (`ON DUPLICATE KEY UPDATE`)
 * because a rollup that cannot be safely re-run is a rollup nobody dares fix.
 *
 * Every scan is bounded by day. `trips` is not partitioned, but an unbounded
 * scan over it would still be the slowest query in the app once history grows,
 * and bounding it keeps the index on `started_at` doing the work.
 */

export interface EmissionFactor {
  mode: string;
  gCo2ePerKm: number;
  whPerKm: number;
  source: string;
}

export async function emissionFactors(): Promise<Map<string, EmissionFactor>> {
  const rows = await sequelize.query<{
    mode: string;
    g_co2e_per_km: string;
    wh_per_km: string;
    source: string;
  }>(
    // The factor in force today, not every historical revision.
    `SELECT ef.mode, ef.g_co2e_per_km, ef.wh_per_km, ef.source
       FROM emission_factors ef
       JOIN (SELECT mode, MAX(valid_from) AS vf
               FROM emission_factors WHERE valid_from <= CURDATE() GROUP BY mode) latest
         ON latest.mode = ef.mode AND latest.vf = ef.valid_from`,
    { type: QueryTypes.SELECT },
  );

  return new Map(
    rows.map((r) => [
      r.mode,
      {
        mode: r.mode,
        gCo2ePerKm: Number(r.g_co2e_per_km),
        whPerKm: Number(r.wh_per_km),
        source: r.source,
      },
    ]),
  );
}

/** Rolls up one day. `day` is `YYYY-MM-DD`. */
export async function rollupDay(day: string): Promise<{ trips: number; zones: number }> {
  const factors = await emissionFactors();
  const car = factors.get('car')?.gCo2ePerKm ?? 120;

  const byMode = await sequelize.query<{
    type: string;
    trips: string;
    distance_m: string | null;
    duration_s: string | null;
  }>(
    `SELECT v.type,
            COUNT(*)          AS trips,
            SUM(t.distance_m) AS distance_m,
            SUM(t.duration_s) AS duration_s
       FROM trips t
       JOIN vehicles v ON v.id = t.vehicle_id
      WHERE t.started_at >= :day AND t.started_at < DATE_ADD(:day, INTERVAL 1 DAY)
      GROUP BY v.type`,
    { replacements: { day }, type: QueryTypes.SELECT },
  );

  let trips = 0;
  let distanceKm = 0;
  let durationMin = 0;
  let energyKwh = 0;
  let co2Kg = 0;
  const modal: Record<string, number> = {};

  for (const row of byMode) {
    const n = Number(row.trips);
    const km = Number(row.distance_m ?? 0) / 1000;
    const min = Number(row.duration_s ?? 0) / 60;
    const f = factors.get(row.type);

    trips += n;
    distanceKm += km;
    durationMin += min;
    modal[row.type] = n;

    if (f) {
      energyKwh += (f.whPerKm * km) / 1000;
      // The counterfactual: this trip would otherwise have been driven.
      co2Kg += ((car - f.gCo2ePerKm) * km) / 1000;
    }
  }

  for (const k of Object.keys(modal)) {
    modal[k] = trips > 0 ? Number((modal[k]! / trips).toFixed(4)) : 0;
  }

  const [activeRow] = await sequelize.query<{ n: string }>(
    `SELECT COUNT(DISTINCT vehicle_id) AS n FROM trips
      WHERE started_at >= :day AND started_at < DATE_ADD(:day, INTERVAL 1 DAY)`,
    { replacements: { day }, type: QueryTypes.SELECT },
  );
  const activeVehicles = Number(activeRow?.n ?? 0);

  await sequelize.query(
    `INSERT INTO kpi_daily
       (day, trips, distance_km, duration_min, active_vehicles, trips_per_vehicle,
        mean_trip_km, mean_trip_min, energy_kwh, co2e_avoided_kg, modal_split, computed_at)
     VALUES (:day, :trips, :km, :min, :active, :tpv, :mkm, :mmin, :kwh, :co2, :modal, NOW(3))
     ON DUPLICATE KEY UPDATE
       trips = VALUES(trips), distance_km = VALUES(distance_km),
       duration_min = VALUES(duration_min), active_vehicles = VALUES(active_vehicles),
       trips_per_vehicle = VALUES(trips_per_vehicle), mean_trip_km = VALUES(mean_trip_km),
       mean_trip_min = VALUES(mean_trip_min), energy_kwh = VALUES(energy_kwh),
       co2e_avoided_kg = VALUES(co2e_avoided_kg), modal_split = VALUES(modal_split),
       computed_at = NOW(3)`,
    {
      replacements: {
        day,
        trips,
        km: distanceKm.toFixed(3),
        min: durationMin.toFixed(2),
        active: activeVehicles,
        tpv: activeVehicles > 0 ? (trips / activeVehicles).toFixed(3) : '0',
        mkm: trips > 0 ? (distanceKm / trips).toFixed(3) : '0',
        mmin: trips > 0 ? (durationMin / trips).toFixed(2) : '0',
        kwh: energyKwh.toFixed(3),
        co2: co2Kg.toFixed(3),
        modal: JSON.stringify(modal),
      },
    },
  );

  // Per zone. Starts and ends are counted separately because their difference
  // is the overnight drift M07 exists to correct — a zone that persistently
  // ends more trips than it starts is where vehicles pile up.
  const zoneRows = await sequelize.query<{
    zone_id: string;
    started: string;
    ended: string;
    distance_m: string | null;
  }>(
    `SELECT z.id AS zone_id,
            (SELECT COUNT(*) FROM trips t WHERE t.start_zone_id = z.id
               AND t.started_at >= :day AND t.started_at < DATE_ADD(:day, INTERVAL 1 DAY)) AS started,
            (SELECT COUNT(*) FROM trips t WHERE t.end_zone_id = z.id
               AND t.started_at >= :day AND t.started_at < DATE_ADD(:day, INTERVAL 1 DAY)) AS ended,
            (SELECT SUM(t.distance_m) FROM trips t WHERE t.start_zone_id = z.id
               AND t.started_at >= :day AND t.started_at < DATE_ADD(:day, INTERVAL 1 DAY)) AS distance_m
       FROM zones z`,
    { replacements: { day }, type: QueryTypes.SELECT },
  );

  for (const z of zoneRows) {
    const started = Number(z.started);
    const ended = Number(z.ended);
    const km = Number(z.distance_m ?? 0) / 1000;
    // Zone-level CO2 uses the city's average saving per km rather than a
    // per-mode split, which would need a second grouped query per zone for a
    // number nobody reads at that precision.
    const perKm = distanceKm > 0 ? co2Kg / distanceKm : 0;

    await sequelize.query(
      `INSERT INTO zone_daily_rollups
         (day, zone_id, trips_started, trips_ended, net_flow, distance_km, co2e_avoided_kg, computed_at)
       VALUES (:day, :zone, :started, :ended, :net, :km, :co2, NOW(3))
       ON DUPLICATE KEY UPDATE
         trips_started = VALUES(trips_started), trips_ended = VALUES(trips_ended),
         net_flow = VALUES(net_flow), distance_km = VALUES(distance_km),
         co2e_avoided_kg = VALUES(co2e_avoided_kg), computed_at = NOW(3)`,
      {
        replacements: {
          day,
          zone: z.zone_id,
          started,
          ended,
          net: ended - started,
          km: km.toFixed(3),
          co2: (perKm * km).toFixed(3),
        },
      },
    );
  }

  return { trips, zones: zoneRows.length };
}

/** Rolls up the last `days` days, oldest first. Used by the job and by seeding. */
export async function rollupRecent(days = 42): Promise<{ days: number; trips: number }> {
  let trips = 0;
  const today = new Date();

  for (let i = days; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    const result = await rollupDay(day);
    trips += result.trips;
  }

  logger.info('rollup complete', { days: days + 1, trips });
  return { days: days + 1, trips };
}
