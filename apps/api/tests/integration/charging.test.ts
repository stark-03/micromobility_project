import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { sequelize } from '../../src/db/index.ts';
import { pointLiteral } from '../../src/db/spatial.ts';
import { stationsAlongRoute, vehiclesNear } from '../../src/modules/charging/service.ts';
import { useCleanDatabase } from '../helpers/clean-db.ts';
import { authAs } from '../helpers/auth-as.ts';
import { makeVehicle } from '../helpers/fixtures.ts';
import type { LngLat } from '@mm/shared-types';

const ref = useCleanDatabase();
const app = createApp();

const CAMP: LngLat = [74.5108, 15.8607];
const FORT: LngLat = [74.4968, 15.8517];

async function makeStation(name: string, at: LngLat, status = 'active') {
  const [id] = await sequelize.query(
    `INSERT INTO charging_stations (name, location, connectors, power_kw, status)
     VALUES (:name, ${pointLiteral(at).val}, 4, 3.3, :status)`,
    { replacements: { name, status } },
  );
  return String(id);
}

async function placeVehicle(at: LngLat, status = 'available', battery = 80, type = 'scooter') {
  const v = await makeVehicle({
    operatorId: ref.current.operatorIds[0]!,
    homeZoneId: String(ref.current.zoneIdByCode.get('CMP')!),
    status: status as never,
    type: type as never,
    batteryPct: battery,
  });
  await sequelize.query(
    `UPDATE vehicles SET last_position = ${pointLiteral(at).val} WHERE id = :id`,
    { replacements: { id: String(v.id) } },
  );
  return v;
}

describe('GET /charging/stations/near', () => {
  it('returns metres, not degrees', async () => {
    const s = await authAs(app, 'commuter');
    await makeStation('At the pin', CAMP);

    const res = await request(app)
      .get(`/api/v1/charging/stations/near?lng=${CAMP[0]}&lat=${CAMP[1]}&radiusM=500`)
      .set(...s.auth);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    // A degree of latitude is ~111 km. If this ever comes back as ~0.0001 the
    // query has slipped from ST_Distance_Sphere to plain ST_Distance, and every
    // radius filter in the app becomes meaningless.
    expect(res.body.data[0].distanceM).toBeLessThan(5);
  });

  it('excludes a station outside the radius', async () => {
    const s = await authAs(app, 'commuter');
    await makeStation('Far away', [74.60, 15.95]);

    const res = await request(app)
      .get(`/api/v1/charging/stations/near?lng=${CAMP[0]}&lat=${CAMP[1]}&radiusM=800`)
      .set(...s.auth);
    expect(res.body.data).toHaveLength(0);
  });

  it('hides stations that are not active', async () => {
    const s = await authAs(app, 'commuter');
    await makeStation('Planned only', CAMP, 'planned');

    const res = await request(app)
      .get(`/api/v1/charging/stations/near?lng=${CAMP[0]}&lat=${CAMP[1]}&radiusM=500`)
      .set(...s.auth);
    // A rider routed to a station that does not exist yet is worse than one
    // shown no station at all.
    expect(res.body.data).toHaveLength(0);
  });

  it('sorts nearest first', async () => {
    const s = await authAs(app, 'commuter');
    await makeStation('Further', [74.5140, 15.8607]);
    await makeStation('Nearer', [74.5115, 15.8607]);

    const res = await request(app)
      .get(`/api/v1/charging/stations/near?lng=${CAMP[0]}&lat=${CAMP[1]}&radiusM=2000`)
      .set(...s.auth);
    expect(res.body.data.map((x: { name: string }) => x.name)).toEqual(['Nearer', 'Further']);
  });
});

describe('stationsAlongRoute', () => {
  /** A straight path from Camp to Fort Road, sampled every ~10th of the way. */
  const PATH: LngLat[] = Array.from({ length: 11 }, (_v, i) => [
    CAMP[0] + ((FORT[0] - CAMP[0]) * i) / 10,
    CAMP[1] + ((FORT[1] - CAMP[1]) * i) / 10,
  ]);

  it('finds a station near the MIDDLE of a route, not just its ends', async () => {
    const mid = PATH[5]!;
    await makeStation('Midpoint stop', [mid[0] + 0.0005, mid[1]]);

    const found = await stationsAlongRoute(PATH, 700);
    // This is the whole point of the corridor query. A check against origin and
    // destination alone would return nothing here.
    expect(found.map((f) => f.name)).toContain('Midpoint stop');
  });

  it('excludes a station outside the corridor', async () => {
    await makeStation('Off route', [74.5300, 15.8900]);
    const found = await stationsAlongRoute(PATH, 400);
    expect(found.map((f) => f.name)).not.toContain('Off route');
  });

  it('survives a long route without building an unbounded query', async () => {
    const long: LngLat[] = Array.from({ length: 4000 }, (_v, i) => [
      74.48 + (i * 0.04) / 4000,
      15.82 + (i * 0.05) / 4000,
    ]);
    await makeStation('Somewhere on it', [74.50, 15.845]);
    await expect(stationsAlongRoute(long, 900)).resolves.toBeInstanceOf(Array);
  });

  it('returns nothing for a degenerate path rather than throwing', async () => {
    await expect(stationsAlongRoute([CAMP], 500)).resolves.toEqual([]);
  });
});

describe('GET /charging/vehicles/near', () => {
  it('lists only vehicles a rider could actually take', async () => {
    const s = await authAs(app, 'commuter');
    await placeVehicle(CAMP, 'available');
    // Under a rider, in the workshop, or booked — none of these can be walked to.
    await placeVehicle(CAMP, 'in_use');
    await placeVehicle(CAMP, 'maintenance');
    await placeVehicle(CAMP, 'reserved');

    const res = await request(app)
      .get(`/api/v1/charging/vehicles/near?lng=${CAMP[0]}&lat=${CAMP[1]}&radiusM=500`)
      .set(...s.auth);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].distanceM).toBeLessThan(5);
  });

  it('reports remaining range from battery and mode', async () => {
    await placeVehicle(CAMP, 'available', 50, 'scooter');
    const [v] = await vehiclesNear(CAMP, 500);
    // 50% of a 25 km scooter range.
    expect(v!.rangeM).toBe(12500);
  });

  it('gives a pedal bike no range rather than a fake one', async () => {
    await placeVehicle(CAMP, 'available', 100, 'bike');
    const [v] = await vehiclesNear(CAMP, 500);
    expect(v!.rangeM).toBe(0);
  });

  it('requires authentication', async () => {
    const res = await request(app).get(
      `/api/v1/charging/vehicles/near?lng=${CAMP[0]}&lat=${CAMP[1]}`,
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /charging/stations', () => {
  it('derives the zone from the clicked point', async () => {
    const s = await authAs(app, 'planner');
    const res = await request(app)
      .post('/api/v1/charging/stations')
      .set(...s.auth)
      .send({ name: 'Placed by click', location: CAMP, connectors: 6, powerKw: 7.4 });

    expect(res.status).toBe(201);
    // A planner clicking a map should not also have to say which zone they
    // clicked in; the two could then disagree.
    expect(res.body.data.zoneId).not.toBeNull();
    expect(res.body.data.location).toEqual(CAMP);
  });

  it('refuses a commuter — placing infrastructure is a planning act', async () => {
    const s = await authAs(app, 'commuter');
    const res = await request(app)
      .post('/api/v1/charging/stations')
      .set(...s.auth)
      .send({ name: 'Nope', location: CAMP });
    expect(res.status).toBe(403);
  });

  it.each([
    ['coordinates out of range', { location: [999, 999] }],
    ['a blank name', { name: ' ' }],
    ['zero connectors', { connectors: 0 }],
  ])('rejects %s', async (_label, patch) => {
    const s = await authAs(app, 'planner');
    const res = await request(app)
      .post('/api/v1/charging/stations')
      .set(...s.auth)
      .send({ name: 'Station', location: CAMP, ...patch });
    expect(res.status).toBe(400);
  });

  it('soft deletes so history keeps its reference', async () => {
    const s = await authAs(app, 'planner');
    const id = await makeStation('Temporary', CAMP);

    expect((await request(app).delete(`/api/v1/charging/stations/${id}`).set(...s.auth)).status).toBe(204);

    const list = await request(app).get('/api/v1/charging/stations').set(...s.auth);
    expect(list.body.data.map((x: { id: string }) => x.id)).not.toContain(id);

    const [row] = await sequelize.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM charging_stations WHERE id = :id',
      { replacements: { id }, type: 'SELECT' as never },
    );
    expect(Number(row!.n)).toBe(1);
  });

  it('404s for an unknown station', async () => {
    const s = await authAs(app, 'planner');
    const res = await request(app).get('/api/v1/charging/stations/999999').set(...s.auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('STATION_NOT_FOUND');
  });
});

describe('POST /auth/register', () => {
  it('returns a session so a new rider lands signed in', async () => {
    const email = `rider-${Math.random().toString(36).slice(2, 9)}@example.com`;
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ fullName: 'New Rider', email, password: 'ridedemo2026' });

    expect(res.status).toBe(201);
    // Without a token the signup screen would have to bounce the user to a
    // login form to retype what they just typed.
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.roles).toContain('commuter');
  });

  it('rejects a weak password with the reason', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ fullName: 'Weak', email: 'weak@example.com', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});
