import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ACCESS } from '@mm/shared-types';
import type { AccessRule, Role } from '@mm/shared-types';
import { createApp } from '../../src/app.ts';
import { useCleanDatabase } from '../helpers/clean-db.ts';
import { authAs } from '../helpers/auth-as.ts';

const ref = useCleanDatabase();
const app = createApp();

const HUMAN_ROLES: Role[] = ['admin', 'planner', 'operator', 'analyst', 'commuter'];

/**
 * Every protected read, against the rule that is meant to guard it. The test
 * asks only "did the role check let you through?": a 403 means no, anything
 * else (200, or a 404/503 from further in) means yes.
 */
const ENDPOINTS: Array<[string, AccessRule]> = [
  ['/api/v1/vehicles', 'fleetRead'],
  ['/api/v1/vehicles/summary', 'fleetRead'],
  ['/api/v1/vehicles/1', 'fleetRead'],
  ['/api/v1/vehicles/1/telemetry', 'fleetRead'],
  ['/api/v1/fleet/rebalance/plans', 'fleetRead'],
  ['/api/v1/scenarios', 'simRead'],
  ['/api/v1/runs/1', 'simRead'],
  ['/api/v1/predictions/models', 'dataRead'],
  ['/api/v1/analytics/summary', 'analytics'],
  ['/api/v1/analytics/environment', 'analytics'],
  ['/api/v1/analytics/export', 'analytics'],
  ['/api/v1/rentals', 'ride'],
  ['/api/v1/rentals/active', 'ride'],
  ['/api/v1/rentals/plans', 'ride'],
];

describe('role-based access', () => {
  it.each(HUMAN_ROLES)('applies the access table to %s', async (role) => {
    const s = await authAs(app, role, {
      operatorId: role === 'operator' ? ref.current.operatorIds[0]! : undefined,
    });

    for (const [path, rule] of ENDPOINTS) {
      const allowed = (ACCESS[rule] as readonly string[]).includes(role);
      const res = await request(app).get(path).set(...s.auth);
      expect(res.status === 403, `${role} GET ${path} returned ${res.status}`).toBe(!allowed);
      if (!allowed) expect(res.body.error.code).toBe('FORBIDDEN');
    }
  }, 60_000);

  it('keeps what a rider needs open to a rider', async () => {
    const s = await authAs(app, 'commuter');
    for (const path of [
      '/api/v1/geo/zones',
      '/api/v1/geo/search?q=camp',
      '/api/v1/stations',
      '/api/v1/charging/stations',
      '/api/v1/traffic/live',
    ]) {
      const res = await request(app).get(path).set(...s.auth);
      expect(res.status, path).toBe(200);
    }
  });

  it('stops an analyst changing the fleet, and a planner retraining the model', async () => {
    const analyst = await authAs(app, 'analyst');
    const add = await request(app).post('/api/v1/vehicles').set(...analyst.auth).send({});
    expect(add.status).toBe(403);

    const planner = await authAs(app, 'planner');
    const train = await request(app).post('/api/v1/predictions/train').set(...planner.auth);
    expect(train.status).toBe(403);
  });

  it('rejects everyone without a token, whatever the role table says', async () => {
    const res = await request(app).get('/api/v1/vehicles');
    expect(res.status).toBe(401);
  });
});
