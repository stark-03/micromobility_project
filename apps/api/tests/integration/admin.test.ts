import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { ApiKey, AuditLog } from '../../src/db/models/index.ts';
import { useCleanDatabase } from '../helpers/clean-db.ts';
import { authAs } from '../helpers/auth-as.ts';
import { makeUser } from '../helpers/fixtures.ts';

useCleanDatabase();
const app = createApp();

describe('admin RBAC', () => {
  it.each(['planner', 'operator', 'analyst', 'commuter'] as const)(
    'denies %s access to the admin surface',
    async (role) => {
      const s = await authAs(app, role);

      for (const call of [
        request(app).get('/api/v1/admin/users').set(...s.auth),
        request(app).get('/api/v1/admin/api-keys').set(...s.auth),
        request(app)
          .post('/api/v1/admin/api-keys')
          .set(...s.auth)
          .send({ name: 'x', scopes: ['telemetry:write'] }),
      ]) {
        const res = await call;
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    },
  );

  it('denies an unauthenticated caller', async () => {
    const res = await request(app).get('/api/v1/admin/users');
    expect(res.status).toBe(401);
  });
});

describe('GET /admin/users', () => {
  it('paginates with page/limit/total meta', async () => {
    const admin = await authAs(app, 'admin');
    for (let i = 0; i < 5; i++) await makeUser({ role: 'commuter' });

    const res = await request(app).get('/api/v1/admin/users?page=1&limit=3').set(...admin.auth);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.meta).toEqual({ page: 1, limit: 3, total: 6 }); // 5 + the admin
  });

  it('filters by role', async () => {
    const admin = await authAs(app, 'admin');
    await makeUser({ role: 'planner' });
    await makeUser({ role: 'commuter' });

    const res = await request(app).get('/api/v1/admin/users?role=planner').set(...admin.auth);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].roles).toContain('planner');
  });

  it('filters by status', async () => {
    const admin = await authAs(app, 'admin');
    await makeUser({ role: 'commuter', status: 'suspended' });

    const res = await request(app).get('/api/v1/admin/users?status=suspended').set(...admin.auth);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('suspended');
  });

  it('never leaks password hashes', async () => {
    const admin = await authAs(app, 'admin');
    const res = await request(app).get('/api/v1/admin/users').set(...admin.auth);
    expect(JSON.stringify(res.body)).not.toContain('password');
  });
});

describe('PATCH /admin/users/:id/roles', () => {
  it('replaces the role set', async () => {
    const admin = await authAs(app, 'admin');
    const { user } = await makeUser({ role: 'commuter' });

    const res = await request(app)
      .patch(`/api/v1/admin/users/${user.id}/roles`)
      .set(...admin.auth)
      .send({ roles: ['planner', 'analyst'] });

    expect(res.status).toBe(200);
    expect(res.body.data.roles.sort()).toEqual(['analyst', 'planner']);
  });

  it('records both the before and after sets in the audit log', async () => {
    const admin = await authAs(app, 'admin');
    const { user } = await makeUser({ role: 'commuter' });

    await request(app)
      .patch(`/api/v1/admin/users/${user.id}/roles`)
      .set(...admin.auth)
      .send({ roles: ['operator'] });

    const entry = await AuditLog.findOne({ where: { action: 'admin.user.roles_changed' } });
    expect(entry).not.toBeNull();
    expect(entry!.metadata).toEqual({ before: ['commuter'], after: ['operator'] });
  });

  it('refuses to remove the last admin', async () => {
    const admin = await authAs(app, 'admin');

    const res = await request(app)
      .patch(`/api/v1/admin/users/${admin.user.id}/roles`)
      .set(...admin.auth)
      .send({ roles: ['commuter'] });

    // Otherwise one well-formed request locks every human out of the platform.
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/last admin/i);
  });

  it('allows demoting an admin once a second one exists', async () => {
    const admin = await authAs(app, 'admin');
    await makeUser({ role: 'admin' });

    const res = await request(app)
      .patch(`/api/v1/admin/users/${admin.user.id}/roles`)
      .set(...admin.auth)
      .send({ roles: ['commuter'] });

    expect(res.status).toBe(200);
    expect(res.body.data.roles).toEqual(['commuter']);
  });

  it('rejects an empty role list', async () => {
    const admin = await authAs(app, 'admin');
    const { user } = await makeUser({ role: 'commuter' });

    const res = await request(app)
      .patch(`/api/v1/admin/users/${user.id}/roles`)
      .set(...admin.auth)
      .send({ roles: [] });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown role', async () => {
    const admin = await authAs(app, 'admin');
    const { user } = await makeUser({ role: 'commuter' });

    const res = await request(app)
      .patch(`/api/v1/admin/users/${user.id}/roles`)
      .set(...admin.auth)
      .send({ roles: ['superuser'] });
    expect(res.status).toBe(400);
  });

  it('404s for an unknown user', async () => {
    const admin = await authAs(app, 'admin');
    const res = await request(app)
      .patch('/api/v1/admin/users/999999/roles')
      .set(...admin.auth)
      .send({ roles: ['commuter'] });
    expect(res.status).toBe(404);
  });
});

describe('API keys', () => {
  it('returns the raw key exactly once, at creation', async () => {
    const admin = await authAs(app, 'admin');

    const created = await request(app)
      .post('/api/v1/admin/api-keys')
      .set(...admin.auth)
      .send({ name: 'Belagavi IoT gateway', scopes: ['telemetry:write'] });

    expect(created.status).toBe(201);
    const raw = created.body.data.key as string;
    // Hex prefix, so the underscore delimiter is never ambiguous.
    expect(raw).toMatch(/^mm_[0-9a-f]{8}_[A-Za-z0-9_-]+$/);

    const list = await request(app).get('/api/v1/admin/api-keys').set(...admin.auth);
    expect(JSON.stringify(list.body)).not.toContain(raw);
    // Only the prefix remains readable, and it round-trips through a split
    // on the delimiter — which is exactly what a hex prefix guarantees.
    expect(list.body.data[0].keyPrefix).toBe(raw.split('_')[1]);
    expect(list.body.data[0].keyPrefix).toHaveLength(8);
    expect(list.body.data[0].key).toBeUndefined();
  });

  it('stores only a hash, never the key itself', async () => {
    const admin = await authAs(app, 'admin');
    const created = await request(app)
      .post('/api/v1/admin/api-keys')
      .set(...admin.auth)
      .send({ name: 'gateway', scopes: ['telemetry:write'] });

    const raw = created.body.data.key as string;
    const stored = await ApiKey.findByPk(created.body.data.id);
    expect(stored!.key_hash).toHaveLength(64);
    expect(JSON.stringify(stored!.toJSON())).not.toContain(raw);
  });

  it('gives every key a distinct value', async () => {
    const admin = await authAs(app, 'admin');
    const payload = { name: 'gateway', scopes: ['telemetry:write'] };
    const a = await request(app).post('/api/v1/admin/api-keys').set(...admin.auth).send(payload);
    const b = await request(app).post('/api/v1/admin/api-keys').set(...admin.auth).send(payload);
    expect(a.body.data.key).not.toBe(b.body.data.key);
  });

  it('requires at least one scope', async () => {
    const admin = await authAs(app, 'admin');
    const res = await request(app)
      .post('/api/v1/admin/api-keys')
      .set(...admin.auth)
      .send({ name: 'scopeless', scopes: [] });
    expect(res.status).toBe(400);
  });

  it('revokes a key and audits it', async () => {
    const admin = await authAs(app, 'admin');
    const created = await request(app)
      .post('/api/v1/admin/api-keys')
      .set(...admin.auth)
      .send({ name: 'gateway', scopes: ['telemetry:write'] });

    const res = await request(app)
      .delete(`/api/v1/admin/api-keys/${created.body.data.id}`)
      .set(...admin.auth);

    expect(res.status).toBe(200);
    expect(res.body.data.revokedAt).toEqual(expect.any(String));

    const actions = (await AuditLog.findAll()).map((a) => a.action);
    expect(actions).toContain('admin.api_key.created');
    expect(actions).toContain('admin.api_key.revoked');
  });
});
