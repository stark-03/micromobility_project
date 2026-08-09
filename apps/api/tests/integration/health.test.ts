import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { sequelize } from '../../src/db/index.ts';

const app = createApp();

afterAll(async () => {
  await sequelize.close();
});

describe('health', () => {
  it('GET /healthz returns ok', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: 'ok' } });
  });

  it('GET /readyz reports MySQL up and the ML service not configured', async () => {
    const res = await request(app).get('/readyz');
    expect(res.status).toBe(200);
    // The ML service does not exist until Sprint 3; readiness must not go red
    // for a component nobody has built.
    expect(res.body.data).toEqual({ mysql: 'ok', ml: 'not_configured' });
  });

  it('returns ROUTE_NOT_FOUND for an unknown route', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    // Distinct from USER_NOT_FOUND: the frontend switches on `code`, so an
    // unmatched route must not look like a missing user.
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(res.body.error.message).toContain('/api/v1/nope');
    expect(res.body.data).toBeUndefined();
  });

  it('does not advertise the framework', async () => {
    const res = await request(app).get('/healthz');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
