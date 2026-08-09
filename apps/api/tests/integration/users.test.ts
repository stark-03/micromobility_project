import crypto from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { sequelize } from '../../src/db/index.ts';
import { Trip, User } from '../../src/db/models/index.ts';
import { pointLiteral } from '../../src/db/spatial.ts';
import { useCleanDatabase } from '../helpers/clean-db.ts';
import { authAs } from '../helpers/auth-as.ts';
import { makeVehicle } from '../helpers/fixtures.ts';

const ref = useCleanDatabase();
const app = createApp();

const BELAGAVI: [number, number] = [74.4977, 15.8497];

describe('GET /users/me', () => {
  it('returns the signed-in user with their roles', async () => {
    const s = await authAs(app, 'planner');
    const res = await request(app).get('/api/v1/users/me').set(...s.auth);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(s.email);
    expect(res.body.data.roles).toEqual(['planner']);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a garbage bearer token', async () => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
  });

  it('never exposes the password hash', async () => {
    const s = await authAs(app, 'commuter');
    const res = await request(app).get('/api/v1/users/me').set(...s.auth);
    expect(JSON.stringify(res.body)).not.toContain('password');
  });
});

describe('PATCH /users/me', () => {
  it('updates the editable fields', async () => {
    const s = await authAs(app, 'commuter');
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set(...s.auth)
      .send({ fullName: 'Renamed Rider', phone: '+919999000011' });

    expect(res.status).toBe(200);
    expect(res.body.data.fullName).toBe('Renamed Rider');
    expect(res.body.data.phone).toBe('+919999000011');
  });

  it('refuses to let a user change their own email', async () => {
    const s = await authAs(app, 'commuter');
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set(...s.auth)
      .send({ email: 'hijack@belagavi.local' });

    // .strict() means an unexpected key is rejected outright rather than
    // silently dropped — the caller learns the field is not editable.
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');

    const fresh = await User.findOne({ where: { email: s.email } });
    expect(fresh).not.toBeNull();
  });

  it('refuses to let a user grant themselves a role', async () => {
    const s = await authAs(app, 'commuter');
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set(...s.auth)
      .send({ roles: ['admin'] });

    expect(res.status).toBe(400);

    const check = await request(app).get('/api/v1/users/me').set(...s.auth);
    expect(check.body.data.roles).toEqual(['commuter']);
  });
});

describe('preferences', () => {
  it('returns defaults for a new user', async () => {
    const s = await authAs(app, 'commuter');
    const res = await request(app).get('/api/v1/users/me/preferences').set(...s.auth);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      language: 'en',
      units: 'metric',
      theme: 'dark',
      notificationsEnabled: true,
    });
  });

  it('updates and persists', async () => {
    const s = await authAs(app, 'commuter');
    await request(app)
      .patch('/api/v1/users/me/preferences')
      .set(...s.auth)
      .send({ units: 'imperial', preferredVehicleType: 'ebike', theme: 'light' });

    const res = await request(app).get('/api/v1/users/me/preferences').set(...s.auth);
    expect(res.body.data).toMatchObject({
      units: 'imperial',
      preferredVehicleType: 'ebike',
      theme: 'light',
    });
  });

  it('rejects an unknown vehicle type', async () => {
    const s = await authAs(app, 'commuter');
    const res = await request(app)
      .patch('/api/v1/users/me/preferences')
      .set(...s.auth)
      .send({ preferredVehicleType: 'hovercraft' });
    expect(res.status).toBe(400);
  });
});

describe('saved places', () => {
  it('creates a place and reads the coordinates back in [lng, lat]', async () => {
    const s = await authAs(app, 'commuter');
    const create = await request(app)
      .post('/api/v1/users/me/places')
      .set(...s.auth)
      .send({ label: 'Home', kind: 'home', position: BELAGAVI, address: 'Tilakwadi' });

    expect(create.status).toBe(201);
    expect(create.body.data.position.coordinates[0]).toBeCloseTo(74.4977, 4);
    expect(create.body.data.position.coordinates[1]).toBeCloseTo(15.8497, 4);

    const list = await request(app).get('/api/v1/users/me/places').set(...s.auth);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].position.coordinates[0]).toBeCloseTo(74.4977, 4);
  });

  it('rejects an out-of-range coordinate', async () => {
    const s = await authAs(app, 'commuter');
    const res = await request(app)
      .post('/api/v1/users/me/places')
      .set(...s.auth)
      .send({ label: 'Nowhere', position: [999, 15.8] });
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate label for the same user', async () => {
    const s = await authAs(app, 'commuter');
    const place = { label: 'Home', position: BELAGAVI };
    await request(app).post('/api/v1/users/me/places').set(...s.auth).send(place);
    const dup = await request(app).post('/api/v1/users/me/places').set(...s.auth).send(place);
    expect(dup.status).toBe(409);
  });

  it('lets two different users each have a place labelled Home', async () => {
    const a = await authAs(app, 'commuter');
    const b = await authAs(app, 'commuter');
    const place = { label: 'Home', position: BELAGAVI };

    expect((await request(app).post('/api/v1/users/me/places').set(...a.auth).send(place)).status).toBe(201);
    expect((await request(app).post('/api/v1/users/me/places').set(...b.auth).send(place)).status).toBe(201);
  });

  it('updates a place, including its position', async () => {
    const s = await authAs(app, 'commuter');
    const created = await request(app)
      .post('/api/v1/users/me/places')
      .set(...s.auth)
      .send({ label: 'Work', position: BELAGAVI });

    const moved: [number, number] = [74.51, 15.86];
    const res = await request(app)
      .patch(`/api/v1/users/me/places/${created.body.data.id}`)
      .set(...s.auth)
      .send({ label: 'Office', position: moved });

    expect(res.status).toBe(200);
    expect(res.body.data.label).toBe('Office');
    expect(res.body.data.position.coordinates[0]).toBeCloseTo(74.51, 4);
    expect(res.body.data.position.coordinates[1]).toBeCloseTo(15.86, 4);
  });

  it('hides another user’s place behind a 404, not a 403', async () => {
    const owner = await authAs(app, 'commuter');
    const other = await authAs(app, 'commuter');

    const created = await request(app)
      .post('/api/v1/users/me/places')
      .set(...owner.auth)
      .send({ label: 'Home', position: BELAGAVI });

    const read = await request(app)
      .patch(`/api/v1/users/me/places/${created.body.data.id}`)
      .set(...other.auth)
      .send({ label: 'Stolen' });

    // 403 would confirm the id exists. 404 leaks nothing.
    expect(read.status).toBe(404);
    expect(read.body.error.code).toBe('SAVED_PLACE_NOT_FOUND');
  });

  it('deletes a place', async () => {
    const s = await authAs(app, 'commuter');
    const created = await request(app)
      .post('/api/v1/users/me/places')
      .set(...s.auth)
      .send({ label: 'Gym', position: BELAGAVI });

    const del = await request(app)
      .delete(`/api/v1/users/me/places/${created.body.data.id}`)
      .set(...s.auth);
    expect(del.status).toBe(204);

    const list = await request(app).get('/api/v1/users/me/places').set(...s.auth);
    expect(list.body.data).toHaveLength(0);
  });
});

describe('GET /users/me/trips', () => {
  async function seedTrips(userId: string, count: number): Promise<void> {
    const vehicle = await makeVehicle({ operatorId: ref.current.operatorIds[0]! });
    for (let i = 0; i < count; i++) {
      await sequelize.query(
        `INSERT INTO trips (public_ref, user_id, vehicle_id, operator_id, started_at, ended_at,
                            start_position, end_position, distance_m, duration_s, status)
         VALUES (?, ?, ?, ?, DATE_SUB(NOW(3), INTERVAL ? MINUTE), NOW(3),
                 ${pointLiteral(BELAGAVI).val as string},
                 ${pointLiteral([74.51, 15.86]).val as string}, ?, ?, 'completed')`,
        {
          replacements: [
            crypto.randomUUID(), userId, vehicle.id, ref.current.operatorIds[0], i + 1,
            1234.5, 600,
          ],
        },
      );
    }
  }

  it('returns an empty list with a null cursor for a new user', async () => {
    const s = await authAs(app, 'commuter');
    const res = await request(app).get('/api/v1/users/me/trips').set(...s.auth);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.nextCursor).toBeNull();
  });

  it('returns the caller\'s trips newest first, with numeric decimals', async () => {
    const s = await authAs(app, 'commuter');
    await seedTrips(s.user.id, 3);

    const res = await request(app).get('/api/v1/users/me/trips').set(...s.auth);
    expect(res.body.data).toHaveLength(3);
    // DECIMAL must not surface as a string.
    expect(res.body.data[0].distanceM).toBe(1234.5);
    expect(typeof res.body.data[0].durationS).toBe('number');

    const times = res.body.data.map((t: { startedAt: string }) => t.startedAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('paginates without duplicating or skipping a row', async () => {
    const s = await authAs(app, 'commuter');
    await seedTrips(s.user.id, 7);

    const first = await request(app).get('/api/v1/users/me/trips?limit=3').set(...s.auth);
    expect(first.body.data).toHaveLength(3);
    expect(first.body.meta.nextCursor).toEqual(expect.any(String));

    const second = await request(app)
      .get(`/api/v1/users/me/trips?limit=3&cursor=${encodeURIComponent(first.body.meta.nextCursor)}`)
      .set(...s.auth);
    const third = await request(app)
      .get(`/api/v1/users/me/trips?limit=3&cursor=${encodeURIComponent(second.body.meta.nextCursor)}`)
      .set(...s.auth);

    const ids = [...first.body.data, ...second.body.data, ...third.body.data].map(
      (t: { id: string }) => t.id,
    );
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
    expect(third.body.meta.nextCursor).toBeNull();
  });

  it('rejects a tampered cursor', async () => {
    const s = await authAs(app, 'commuter');
    const res = await request(app).get('/api/v1/users/me/trips?cursor=garbage').set(...s.auth);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('never returns another user\'s trips', async () => {
    const owner = await authAs(app, 'commuter');
    const other = await authAs(app, 'commuter');
    await seedTrips(owner.user.id, 4);

    const res = await request(app).get('/api/v1/users/me/trips').set(...other.auth);
    expect(res.body.data).toEqual([]);

    // And the rows really do exist — the filter is what excluded them.
    expect(await Trip.count()).toBe(4);
  });
});
