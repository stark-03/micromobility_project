import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { useCleanDatabase } from '../helpers/clean-db.ts';
import { authAs } from '../helpers/auth-as.ts';
import { makeUser, makeVehicle } from '../helpers/fixtures.ts';

const ref = useCleanDatabase();
const app = createApp();

describe('granting the operator role', () => {
  it('requires choosing the company they work for', async () => {
    const admin = await authAs(app, 'admin');
    const { user } = await makeUser({ role: 'commuter' });

    const res = await request(app)
      .patch(`/api/v1/admin/users/${user.id}/roles`)
      .set(...admin.auth)
      .send({ roles: ['operator'] });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('operatorId');
  });

  it('attaches them to that company, and they then see only its fleet', async () => {
    const admin = await authAs(app, 'admin');
    const [mine, theirs] = ref.current.operatorIds;
    await makeVehicle({ operatorId: mine!, externalRef: 'MINE-1' });
    await makeVehicle({ operatorId: theirs!, externalRef: 'THEIRS-1' });
    const { user, password } = await makeUser({ role: 'commuter' });

    const res = await request(app)
      .patch(`/api/v1/admin/users/${user.id}/roles`)
      .set(...admin.auth)
      .send({ roles: ['operator'], operatorId: mine });
    expect(res.status).toBe(200);
    expect(res.body.data.operatorId).toBe(String(mine));

    // The new role is in the token from their next sign-in.
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password });
    const fleet = await request(app)
      .get('/api/v1/vehicles')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`);
    expect(fleet.body.data.map((v: { externalRef: string }) => v.externalRef)).toEqual(['MINE-1']);
  });

  it('rejects a company that does not exist', async () => {
    const admin = await authAs(app, 'admin');
    const { user } = await makeUser({ role: 'commuter' });
    const res = await request(app)
      .patch(`/api/v1/admin/users/${user.id}/roles`)
      .set(...admin.auth)
      .send({ roles: ['operator'], operatorId: '999999' });
    expect(res.status).toBe(400);
  });

  it('clears the company when the operator role is taken away', async () => {
    const admin = await authAs(app, 'admin');
    const { user } = await makeUser({ role: 'operator', operatorId: ref.current.operatorIds[0]! });
    const res = await request(app)
      .patch(`/api/v1/admin/users/${user.id}/roles`)
      .set(...admin.auth)
      .send({ roles: ['commuter'] });
    expect(res.body.data.operatorId).toBeNull();
  });

  it('lists the companies to choose from, for admins only', async () => {
    const admin = await authAs(app, 'admin');
    const res = await request(app).get('/api/v1/admin/operators').set(...admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toEqual(expect.objectContaining({ id: expect.any(String), name: expect.any(String) }));

    const planner = await authAs(app, 'planner');
    const no = await request(app).get('/api/v1/admin/operators').set(...planner.auth);
    expect(no.status).toBe(403);
  });
});

describe('an operator not attached to any company', () => {
  it('sees no vehicles rather than every operator’s', async () => {
    await makeVehicle({ operatorId: ref.current.operatorIds[0]! });
    await makeVehicle({ operatorId: ref.current.operatorIds[1]! });
    const orphan = await authAs(app, 'operator');

    const list = await request(app).get('/api/v1/vehicles').set(...orphan.auth);
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);

    const summary = await request(app).get('/api/v1/vehicles/summary').set(...orphan.auth);
    expect(summary.body.data.total).toBe(0);
  });

  it('cannot register a vehicle for any company', async () => {
    const orphan = await authAs(app, 'operator');
    const res = await request(app)
      .post('/api/v1/vehicles')
      .set(...orphan.auth)
      .send({ operatorId: ref.current.operatorIds[0], externalRef: 'X-1', type: 'scooter' });
    expect(res.status).toBe(403);
  });
});

describe('POST /analytics/rollup', () => {
  it('lets an admin build the dashboard’s rollups now', async () => {
    const admin = await authAs(app, 'admin');
    const res = await request(app).post('/api/v1/analytics/rollup').set(...admin.auth);
    expect(res.status).toBe(202);
    expect(res.body.data).toMatchObject({ status: 'queued', days: 45 });
  });

  it('is refused to planners and analysts, who can read analytics but not rebuild them', async () => {
    for (const role of ['planner', 'analyst'] as const) {
      const s = await authAs(app, role);
      const res = await request(app).post('/api/v1/analytics/rollup').set(...s.auth);
      expect(res.status, role).toBe(403);
    }
  });
});
