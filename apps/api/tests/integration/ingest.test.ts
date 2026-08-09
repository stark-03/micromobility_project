import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { Vehicle, VehicleTelemetry } from '../../src/db/models/index.ts';
import { useCleanDatabase } from '../helpers/clean-db.ts';
import { authAs } from '../helpers/auth-as.ts';
import { makeVehicle } from '../helpers/fixtures.ts';

const ref = useCleanDatabase();
const app = createApp();

const BELAGAVI: [number, number] = [74.4977, 15.8497];

async function makeKey(scopes = ['telemetry:write'], operatorId?: string): Promise<string> {
  const admin = await authAs(app, 'admin');
  const res = await request(app)
    .post('/api/v1/admin/api-keys')
    .set(...admin.auth)
    .send({ name: 'gateway', scopes, operatorId: operatorId ?? null });
  return res.body.data.key as string;
}

function reading(vehicleId: string, overrides: Record<string, unknown> = {}) {
  return {
    vehicleId: String(vehicleId),
    recordedAt: new Date().toISOString(),
    position: BELAGAVI,
    speedKph: 14.5,
    batteryPct: 73,
    odometerM: 120_000,
    lockState: 'unlocked',
    source: 'gps',
    ...overrides,
  };
}

describe('POST /ingest/telemetry', () => {
  it('rejects a request with no API key', async () => {
    const res = await request(app).post('/api/v1/ingest/telemetry').send({ readings: [] });
    expect(res.status).toBe(401);
  });

  it('rejects a user access token — this endpoint is device-only', async () => {
    const admin = await authAs(app, 'admin');
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]! });

    const res = await request(app)
      .post('/api/v1/ingest/telemetry')
      .set(...admin.auth)
      .send({ readings: [reading(v.id)] });

    expect(res.status).toBe(401);
  });

  it('rejects a key without the telemetry:write scope', async () => {
    const key = await makeKey(['traffic:write']);
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]! });

    const res = await request(app)
      .post('/api/v1/ingest/telemetry')
      .set('Authorization', `Bearer ${key}`)
      .send({ readings: [reading(v.id)] });

    expect(res.status).toBe(403);
  });

  it('accepts a batch and rolls the vehicle summary forward', async () => {
    const key = await makeKey();
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]!, batteryPct: 10 });

    const res = await request(app)
      .post('/api/v1/ingest/telemetry')
      .set('Authorization', `Bearer ${key}`)
      .send({
        readings: [
          reading(v.id, { recordedAt: new Date(Date.now() - 60_000).toISOString(), batteryPct: 70 }),
          reading(v.id, { batteryPct: 68 }),
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.accepted).toBe(2);
    expect(res.body.data.rejected).toEqual([]);
    expect(await VehicleTelemetry.count()).toBe(2);

    // Summary comes from the NEWEST reading, not the last one in the array.
    const fresh = await Vehicle.findByPk(v.id);
    expect(fresh!.battery_pct).toBe(68);
    expect(fresh!.last_seen_at).not.toBeNull();
  });

  it('rejects a reading more than 10 minutes in the future', async () => {
    const key = await makeKey();
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]! });

    const res = await request(app)
      .post('/api/v1/ingest/telemetry')
      .set('Authorization', `Bearer ${key}`)
      .send({
        readings: [reading(v.id, { recordedAt: new Date(Date.now() + 20 * 60_000).toISOString() })],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.accepted).toBe(0);
    expect(res.body.data.rejected[0].reason).toMatch(/future/);
  });

  it('rejects a reading more than 24 hours old', async () => {
    const key = await makeKey();
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]! });

    const res = await request(app)
      .post('/api/v1/ingest/telemetry')
      .set('Authorization', `Bearer ${key}`)
      .send({
        readings: [
          reading(v.id, { recordedAt: new Date(Date.now() - 48 * 3600_000).toISOString() }),
        ],
      });

    expect(res.body.data.accepted).toBe(0);
    expect(res.body.data.rejected[0].reason).toMatch(/past/);
  });

  it('accepts the good readings in a mixed batch and names the bad ones', async () => {
    const key = await makeKey();
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]! });

    const res = await request(app)
      .post('/api/v1/ingest/telemetry')
      .set('Authorization', `Bearer ${key}`)
      .send({
        readings: [
          reading(v.id),
          reading(v.id, { recordedAt: new Date(Date.now() + 3600_000).toISOString() }),
          reading(v.id),
        ],
      });

    // A gateway must not lose 499 good readings because one had a bad clock.
    expect(res.body.data.accepted).toBe(2);
    expect(res.body.data.rejected).toEqual([
      { index: 1, reason: expect.stringMatching(/future/) },
    ]);
  });

  it('rejects a reading for an unknown vehicle', async () => {
    const key = await makeKey();
    const res = await request(app)
      .post('/api/v1/ingest/telemetry')
      .set('Authorization', `Bearer ${key}`)
      .send({ readings: [reading('999999')] });

    expect(res.body.data.accepted).toBe(0);
    expect(res.body.data.rejected[0].reason).toBe('Unknown vehicle');
  });

  it("gives an operator-scoped key the same answer for another operator's vehicle as for a missing one", async () => {
    const [opA, opB] = ref.current.operatorIds as [string, string];
    const key = await makeKey(['telemetry:write'], opA);
    const foreign = await makeVehicle({ operatorId: opB });

    const res = await request(app)
      .post('/api/v1/ingest/telemetry')
      .set('Authorization', `Bearer ${key}`)
      .send({ readings: [reading(foreign.id), reading('999999')] });

    // Identical wording, so the key cannot enumerate another operator's ids by
    // watching the message change.
    expect(res.body.data.rejected.map((r: { reason: string }) => r.reason)).toEqual([
      'Unknown vehicle',
      'Unknown vehicle',
    ]);
    expect(await VehicleTelemetry.count()).toBe(0);
  });

  it('rejects a revoked key', async () => {
    const admin = await authAs(app, 'admin');
    const created = await request(app)
      .post('/api/v1/admin/api-keys')
      .set(...admin.auth)
      .send({ name: 'gateway', scopes: ['telemetry:write'] });

    await request(app)
      .delete(`/api/v1/admin/api-keys/${created.body.data.id}`)
      .set(...admin.auth);

    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]! });
    const res = await request(app)
      .post('/api/v1/ingest/telemetry')
      .set('Authorization', `Bearer ${created.body.data.key}`)
      .send({ readings: [reading(v.id)] });

    expect(res.status).toBe(401);
  });

  it('rejects an empty batch and one over the 500 limit', async () => {
    const key = await makeKey();
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]! });

    const empty = await request(app)
      .post('/api/v1/ingest/telemetry')
      .set('Authorization', `Bearer ${key}`)
      .send({ readings: [] });
    expect(empty.status).toBe(400);

    const huge = await request(app)
      .post('/api/v1/ingest/telemetry')
      .set('Authorization', `Bearer ${key}`)
      .send({ readings: Array.from({ length: 501 }, () => reading(v.id)) });
    expect(huge.status).toBe(400);
  });

  it('stores position as lat/lng but returns it as a GeoPoint in [lng, lat]', async () => {
    const key = await makeKey();
    const admin = await authAs(app, 'admin');
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]! });

    await request(app)
      .post('/api/v1/ingest/telemetry')
      .set('Authorization', `Bearer ${key}`)
      .send({ readings: [reading(v.id)] });

    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const res = await request(app)
      .get(`/api/v1/vehicles/${v.id}/telemetry?from=${from}&to=${to}`)
      .set(...admin.auth);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].position.type).toBe('Point');
    expect(res.body.data[0].position.coordinates[0]).toBeCloseTo(74.4977, 4);
    expect(res.body.data[0].position.coordinates[1]).toBeCloseTo(15.8497, 4);
    // DECIMAL must not surface as a string.
    expect(typeof res.body.data[0].speedKph).toBe('number');
  });
});
