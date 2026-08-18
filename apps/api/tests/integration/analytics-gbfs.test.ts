import request from 'supertest';
import { describe, expect, it, beforeEach } from 'vitest';
import { createApp } from '../../src/app.ts';
import { cache } from '../../src/cache/index.ts';
import { sequelize } from '../../src/db/index.ts';
import { pointLiteral } from '../../src/db/spatial.ts';
import { rollupDay, emissionFactors } from '../../src/modules/analytics/rollups.ts';
import { useCleanDatabase } from '../helpers/clean-db.ts';
import { authAs } from '../helpers/auth-as.ts';
import { makeVehicle } from '../helpers/fixtures.ts';

const ref = useCleanDatabase();
const app = createApp();

const DAY = '2026-08-10';

/** Two trips on DAY: one scooter, one bike, with known distances. */
async function seedTrips() {
  const op = ref.current.operatorIds[0]!;
  const zoneA = String(ref.current.zoneIdByCode.get('CMP')!);
  const zoneB = String(ref.current.zoneIdByCode.get('TLK')!);

  const scooter = await makeVehicle({ operatorId: op, type: 'scooter', homeZoneId: zoneA });
  const bike = await makeVehicle({ operatorId: op, type: 'bike', homeZoneId: zoneA });

  for (const [i, v] of [scooter, bike].entries()) {
    await sequelize.query(
      `INSERT INTO trips
         (public_ref, vehicle_id, operator_id, start_zone_id, end_zone_id,
          started_at, ended_at, distance_m, duration_s, status)
       VALUES (:ref, :vehicle, :op, :from, :to,
               :day, DATE_ADD(:day, INTERVAL 15 MINUTE), 5000, 900, 'completed')`,
      {
        replacements: {
          ref: `T-${DAY}-${i}`,
          vehicle: String(v.id),
          op,
          from: zoneA,
          to: zoneB,
          day: `${DAY} 09:00:00`,
        },
      },
    );
  }
}

describe('emission factors', () => {
  it('covers every vehicle type, so no mode is silently free', async () => {
    // A missing factor does not crash — it contributes zero to both energy and
    // CO2, quietly understating the headline claim. That is exactly how the
    // `ev` factor was missed, so this test names every type.
    const factors = await emissionFactors();
    for (const mode of ['scooter', 'bike', 'ebike', 'ev', 'car']) {
      expect(factors.has(mode), `no emission factor for "${mode}"`).toBe(true);
    }
  });

  it('cites a source for every factor', async () => {
    const factors = await emissionFactors();
    for (const f of factors.values()) {
      expect(f.source.length, `${f.mode} has no cited source`).toBeGreaterThan(10);
    }
  });
});

describe('rollupDay', () => {
  beforeEach(seedTrips);

  it('aggregates trips into kpi_daily', async () => {
    const result = await rollupDay(DAY);
    expect(result.trips).toBe(2);

    const [row] = await sequelize.query<Record<string, unknown>>(
      'SELECT * FROM kpi_daily WHERE day = :day',
      { replacements: { day: DAY }, type: 'SELECT' as never },
    );
    expect(Number(row!.trips)).toBe(2);
    expect(Number(row!.distance_km)).toBeCloseTo(10, 1);
    expect(Number(row!.active_vehicles)).toBe(2);
  });

  it('credits CO2 against the car counterfactual, per mode', async () => {
    await rollupDay(DAY);
    const [row] = await sequelize.query<{ co2e_avoided_kg: string }>(
      'SELECT co2e_avoided_kg FROM kpi_daily WHERE day = :day',
      { replacements: { day: DAY }, type: 'SELECT' as never },
    );
    // scooter 5 km at (120-22) g/km = 490 g; bike 5 km at 120 g/km = 600 g.
    expect(Number(row!.co2e_avoided_kg)).toBeCloseTo(1.09, 2);
  });

  it('is idempotent — re-running a day does not double it', async () => {
    await rollupDay(DAY);
    await rollupDay(DAY);

    const rows = await sequelize.query<{ trips: string }>(
      'SELECT trips FROM kpi_daily WHERE day = :day',
      { replacements: { day: DAY }, type: 'SELECT' as never },
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.trips)).toBe(2);
  });

  it('records net flow per zone, which is where vehicles pile up', async () => {
    await rollupDay(DAY);
    const rows = await sequelize.query<{ zone_id: string; net_flow: string }>(
      'SELECT zone_id, net_flow FROM zone_daily_rollups WHERE day = :day',
      { replacements: { day: DAY }, type: 'SELECT' as never },
    );
    const byZone = new Map(rows.map((r) => [String(r.zone_id), Number(r.net_flow)]));
    // Both trips ran CMP -> TLK, so Camp loses two and Tilakwadi gains two.
    expect(byZone.get(String(ref.current.zoneIdByCode.get('CMP')!))).toBe(-2);
    expect(byZone.get(String(ref.current.zoneIdByCode.get('TLK')!))).toBe(2);
  });
});

describe('GET /analytics/*', () => {
  beforeEach(async () => {
    await seedTrips();
    await rollupDay(DAY);
  });

  it('summary totals come from the rollups', async () => {
    const s = await authAs(app, 'analyst');
    const res = await request(app)
      .get(`/api/v1/analytics/summary?from=${DAY}&to=${DAY}`)
      .set(...s.auth);

    expect(res.status).toBe(200);
    expect(res.body.data.totals.trips).toBe(2);
    expect(res.body.data.range.days).toBe(1);
    expect(res.body.data.zones.length).toBeGreaterThan(0);
  });

  it('modal split is weighted by trips, not an average of daily percentages', async () => {
    const s = await authAs(app, 'analyst');
    const res = await request(app)
      .get(`/api/v1/analytics/summary?from=${DAY}&to=${DAY}`)
      .set(...s.auth);

    const split = res.body.data.modalSplit as Record<string, number>;
    expect(split.scooter).toBeCloseTo(0.5, 2);
    expect(split.bike).toBeCloseTo(0.5, 2);
    const total = Object.values(split).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 2);
  });

  it('environment states its counterfactual and the factors behind it', async () => {
    const s = await authAs(app, 'analyst');
    const res = await request(app)
      .get(`/api/v1/analytics/environment?from=${DAY}&to=${DAY}`)
      .set(...s.auth);

    expect(res.status).toBe(200);
    // A bare CO2 number is a claim; the assumption behind it must travel with it.
    expect(res.body.data.counterfactual).toMatch(/car trip/i);
    expect(res.body.data.factors.length).toBeGreaterThanOrEqual(5);
  });

  it('timeseries returns one point per day in range', async () => {
    const s = await authAs(app, 'analyst');
    const res = await request(app)
      .get(`/api/v1/analytics/timeseries?from=${DAY}&to=${DAY}`)
      .set(...s.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].day).toBe(DAY);
  });

  it('exports CSV with a filename and a header row', async () => {
    const s = await authAs(app, 'analyst');
    const res = await request(app)
      .get(`/api/v1/analytics/export?from=${DAY}&to=${DAY}`)
      .set(...s.auth);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=/);

    const [header, first] = res.text.trim().split('\n');
    expect(header).toContain('day,trips,distance_km');
    expect(first).toContain(DAY);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/analytics/summary')).status).toBe(401);
  });

  it('rejects a malformed date', async () => {
    const s = await authAs(app, 'analyst');
    const res = await request(app).get('/api/v1/analytics/summary?from=last-tuesday').set(...s.auth);
    expect(res.status).toBe(400);
  });
});

describe('GBFS 2.3 feed', () => {
  /**
   * The feed is cached for its own 60s TTL, which is correct in production and
   * poison in a test file: without this, the second test to hit
   * free_bike_status reads the first test's fleet and passes vacuously.
   */
  beforeEach(async () => {
    await cache.flush();
  });

  /** GBFS only publishes vehicles whose position is known, so fixtures need one. */
  async function placeVehicle(status: string, at: [number, number] = [74.51, 15.86]) {
    const v = await makeVehicle({
      operatorId: ref.current.operatorIds[0]!,
      homeZoneId: String(ref.current.zoneIdByCode.get('CMP')!),
      status: status as never,
    });
    await sequelize.query(
      `UPDATE vehicles SET last_position = ${pointLiteral(at).val} WHERE id = :id`,
      { replacements: { id: String(v.id) } },
    );
    return v;
  }

  it('is public — no token, no 401', async () => {
    const res = await request(app).get('/gbfs/2.3/gbfs.json');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('2.3');
    expect(res.body.data.en.feeds.map((f: { name: string }) => f.name)).toContain(
      'free_bike_status',
    );
  });

  it('wraps payloads in the GBFS envelope, not the project envelope', async () => {
    const res = await request(app).get('/gbfs/2.3/system_information.json');
    // GBFS consumers parse last_updated/ttl/version/data. Our own {data,meta}
    // envelope would make the feed non-conformant.
    expect(res.body).toHaveProperty('last_updated');
    expect(res.body).toHaveProperty('ttl');
    expect(res.body.data.system_id).toBe('belagavi_micromobility');
  });

  it('publishes ONLY available vehicles — an in-use one is a rider location', async () => {
    await placeVehicle('available');
    await placeVehicle('in_use');
    await placeVehicle('maintenance');

    const res = await request(app).get('/gbfs/2.3/free_bike_status.json');
    expect(res.status).toBe(200);

    const bikes = res.body.data.bikes as unknown[];
    // Exactly the one available vehicle. If this ever counts more, the feed is
    // broadcasting where somebody currently is.
    expect(bikes).toHaveLength(1);
  });

  it('does not expose the database id as bike_id', async () => {
    const v = await placeVehicle('available');

    const res = await request(app).get('/gbfs/2.3/free_bike_status.json');
    const bikes = res.body.data.bikes as { bike_id: string }[];
    expect(bikes).toHaveLength(1);
    // GBFS 2.x: bike_id must not be a persistent identifier, or a third party
    // can reconstruct one vehicle's history and the movements of its riders.
    expect(bikes.map((b) => b.bike_id)).not.toContain(String(v.id));
  });

  it('lists every vehicle type the system runs', async () => {
    const res = await request(app).get('/gbfs/2.3/vehicle_types.json');
    const ids = (res.body.data.vehicle_types as { vehicle_type_id: string }[]).map(
      (t) => t.vehicle_type_id,
    );
    expect(ids.sort()).toEqual(['bike', 'ebike', 'ev', 'scooter']);
  });
});
