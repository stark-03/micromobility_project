import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { AuditLog, VehicleStatusHistory } from '../../src/db/models/index.ts';
import { bus } from '../../src/realtime/bus.ts';
import { useCleanDatabase } from '../helpers/clean-db.ts';
import { authAs } from '../helpers/auth-as.ts';
import { makeVehicle } from '../helpers/fixtures.ts';

const ref = useCleanDatabase();
const app = createApp();

const BELAGAVI: [number, number] = [74.4977, 15.8497];

function newVehicle(operatorId: string, extra: Record<string, unknown> = {}) {
  return {
    operatorId,
    externalRef: `REF-${Math.random().toString(36).slice(2, 10)}`,
    type: 'scooter',
    ...extra,
  };
}

describe('GET /vehicles', () => {
  it('lists with page/limit/total meta', async () => {
    const s = await authAs(app, 'planner');
    const op = ref.current.operatorIds[0]!;
    for (let i = 0; i < 5; i++) await makeVehicle({ operatorId: op });

    const res = await request(app).get('/api/v1/vehicles?limit=3').set(...s.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.meta).toEqual({ page: 1, limit: 3, total: 5 });
  });

  it('filters by status, type and zone', async () => {
    const s = await authAs(app, 'planner');
    const op = ref.current.operatorIds[0]!;
    const zone = ref.current.zoneIdByCode.get('TLK')!;

    await makeVehicle({ operatorId: op, status: 'available', type: 'scooter', homeZoneId: zone });
    await makeVehicle({ operatorId: op, status: 'charging', type: 'ebike' });

    expect((await request(app).get('/api/v1/vehicles?status=charging').set(...s.auth)).body.data).toHaveLength(1);
    expect((await request(app).get('/api/v1/vehicles?type=scooter').set(...s.auth)).body.data).toHaveLength(1);
    expect((await request(app).get(`/api/v1/vehicles?zoneId=${zone}`).set(...s.auth)).body.data).toHaveLength(1);
  });

  it('returns an empty list rather than an error when nothing matches', async () => {
    const s = await authAs(app, 'planner');
    const res = await request(app).get('/api/v1/vehicles?status=retired').set(...s.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/vehicles')).status).toBe(401);
  });

  it('scopes an operator to their own fleet', async () => {
    const [opA, opB] = ref.current.operatorIds as [string, string];
    await makeVehicle({ operatorId: opA });
    await makeVehicle({ operatorId: opB });

    const operator = await authAs(app, 'operator', { operatorId: opA });
    const res = await request(app).get('/api/v1/vehicles').set(...operator.auth);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].operatorId).toBe(String(opA));

    // An admin sees both, so the filter is scoping and not an empty database.
    const admin = await authAs(app, 'admin');
    expect((await request(app).get('/api/v1/vehicles').set(...admin.auth)).body.data).toHaveLength(2);
  });
});

describe('POST /vehicles', () => {
  it('creates a vehicle and writes the registration history row', async () => {
    const s = await authAs(app, 'admin');
    const op = ref.current.operatorIds[0]!;

    const res = await request(app)
      .post('/api/v1/vehicles')
      .set(...s.auth)
      .send(newVehicle(op, { position: BELAGAVI, batteryPct: 88 }));

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('available');
    expect(res.body.data.batteryPct).toBe(88);
    expect(res.body.data.lastPosition.coordinates[0]).toBeCloseTo(74.4977, 4);

    const history = await VehicleStatusHistory.findAll({
      where: { vehicle_id: res.body.data.id },
    });
    expect(history).toHaveLength(1);
    expect(history[0]!.from_status).toBeNull();
    expect(history[0]!.to_status).toBe('available');
  });

  it('rejects a duplicate (operator, externalRef)', async () => {
    const s = await authAs(app, 'admin');
    const payload = newVehicle(ref.current.operatorIds[0]!);

    expect((await request(app).post('/api/v1/vehicles').set(...s.auth).send(payload)).status).toBe(201);
    const dup = await request(app).post('/api/v1/vehicles').set(...s.auth).send(payload);

    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('VEHICLE_REF_ALREADY_EXISTS');
  });

  it('allows the same externalRef under a different operator', async () => {
    const s = await authAs(app, 'admin');
    const [opA, opB] = ref.current.operatorIds as [string, string];
    const externalRef = 'SHARED-0001';

    expect((await request(app).post('/api/v1/vehicles').set(...s.auth).send(newVehicle(opA, { externalRef }))).status).toBe(201);
    expect((await request(app).post('/api/v1/vehicles').set(...s.auth).send(newVehicle(opB, { externalRef }))).status).toBe(201);
  });

  it('denies a commuter', async () => {
    const s = await authAs(app, 'commuter');
    const res = await request(app)
      .post('/api/v1/vehicles')
      .set(...s.auth)
      .send(newVehicle(ref.current.operatorIds[0]!));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('denies an analyst and a planner', async () => {
    for (const role of ['analyst', 'planner'] as const) {
      const s = await authAs(app, role);
      const res = await request(app)
        .post('/api/v1/vehicles')
        .set(...s.auth)
        .send(newVehicle(ref.current.operatorIds[0]!));
      expect(res.status, role).toBe(403);
    }
  });

  it('stops an operator registering a vehicle for another operator', async () => {
    const [opA, opB] = ref.current.operatorIds as [string, string];
    const operator = await authAs(app, 'operator', { operatorId: opA });

    const res = await request(app)
      .post('/api/v1/vehicles')
      .set(...operator.auth)
      .send(newVehicle(opB));
    expect(res.status).toBe(403);
  });

  it('emits vehicle:created on the bus', async () => {
    const s = await authAs(app, 'admin');
    const seen: unknown[] = [];
    const handler = (p: unknown) => seen.push(p);
    bus.on('vehicle:created', handler);

    await request(app)
      .post('/api/v1/vehicles')
      .set(...s.auth)
      .send(newVehicle(ref.current.operatorIds[0]!));

    bus.off('vehicle:created', handler);
    expect(seen).toHaveLength(1);
  });
});

describe('PATCH /vehicles/:id/status', () => {
  it('performs a legal transition and writes exactly one history row', async () => {
    const s = await authAs(app, 'admin');
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]!, status: 'available' });

    const res = await request(app)
      .patch(`/api/v1/vehicles/${v.id}/status`)
      .set(...s.auth)
      .send({ to: 'in_use', reason: 'scan-and-go' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('in_use');

    const history = await VehicleStatusHistory.findAll({ where: { vehicle_id: v.id } });
    expect(history).toHaveLength(1);
    expect(history[0]!.from_status).toBe('available');
    expect(history[0]!.reason).toBe('scan-and-go');
  });

  it('rejects an illegal transition and writes NO history row', async () => {
    const s = await authAs(app, 'admin');
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]!, status: 'retired' });

    const res = await request(app)
      .patch(`/api/v1/vehicles/${v.id}/status`)
      .set(...s.auth)
      .send({ to: 'available' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    // The transaction rolled back, so nothing was recorded.
    expect(await VehicleStatusHistory.count({ where: { vehicle_id: v.id } })).toBe(0);
  });

  it('rejects a self-transition', async () => {
    const s = await authAs(app, 'admin');
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]!, status: 'available' });

    const res = await request(app)
      .patch(`/api/v1/vehicles/${v.id}/status`)
      .set(...s.auth)
      .send({ to: 'available' });

    expect(res.status).toBe(409);
    expect(await VehicleStatusHistory.count({ where: { vehicle_id: v.id } })).toBe(0);
  });

  it('audits the change with both states', async () => {
    const s = await authAs(app, 'admin');
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]!, status: 'available' });

    await request(app)
      .patch(`/api/v1/vehicles/${v.id}/status`)
      .set(...s.auth)
      .send({ to: 'charging' });

    const entry = await AuditLog.findOne({ where: { action: 'vehicle.status_changed' } });
    expect(entry!.metadata).toMatchObject({ from: 'available', to: 'charging' });
  });

  it('denies a commuter', async () => {
    const s = await authAs(app, 'commuter');
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]! });
    const res = await request(app)
      .patch(`/api/v1/vehicles/${v.id}/status`)
      .set(...s.auth)
      .send({ to: 'in_use' });
    expect(res.status).toBe(403);
  });

  it('walks the full lifecycle', async () => {
    const s = await authAs(app, 'admin');
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]!, status: 'available' });

    for (const to of ['reserved', 'in_use', 'returning', 'charging', 'available'] as const) {
      const res = await request(app)
        .patch(`/api/v1/vehicles/${v.id}/status`)
        .set(...s.auth)
        .send({ to });
      expect(res.status, `-> ${to}`).toBe(200);
    }

    expect(await VehicleStatusHistory.count({ where: { vehicle_id: v.id } })).toBe(5);
  });
});

describe('GET /vehicles/:id', () => {
  it('404s for an unknown id', async () => {
    const s = await authAs(app, 'planner');
    const res = await request(app).get('/api/v1/vehicles/999999').set(...s.auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('VEHICLE_NOT_FOUND');
  });

  it("hides another operator's vehicle behind a 404, not a 403", async () => {
    const [opA, opB] = ref.current.operatorIds as [string, string];
    const v = await makeVehicle({ operatorId: opB });
    const operator = await authAs(app, 'operator', { operatorId: opA });

    const res = await request(app).get(`/api/v1/vehicles/${v.id}`).set(...operator.auth);
    expect(res.status).toBe(404);
  });
});

describe('GET /vehicles/:id/status-history', () => {
  it('returns history newest first', async () => {
    const s = await authAs(app, 'admin');
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]!, status: 'available' });

    await request(app).patch(`/api/v1/vehicles/${v.id}/status`).set(...s.auth).send({ to: 'charging' });
    await request(app).patch(`/api/v1/vehicles/${v.id}/status`).set(...s.auth).send({ to: 'available' });

    const res = await request(app).get(`/api/v1/vehicles/${v.id}/status-history`).set(...s.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].toStatus).toBe('available');
    expect(res.body.data[0].changedByName).toEqual(expect.any(String));
  });
});

describe('GET /vehicles/:id/telemetry', () => {
  it('refuses an un-bounded query', async () => {
    const s = await authAs(app, 'admin');
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]! });

    const res = await request(app).get(`/api/v1/vehicles/${v.id}/telemetry`).set(...s.auth);
    // vehicle_telemetry is partitioned; an open-ended scan defeats pruning.
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns an empty page for a window with no readings', async () => {
    const s = await authAs(app, 'admin');
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]! });

    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date().toISOString();
    const res = await request(app)
      .get(`/api/v1/vehicles/${v.id}/telemetry?from=${from}&to=${to}`)
      .set(...s.auth);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('maintenance tickets', () => {
  it('opens a ticket and lists it', async () => {
    const s = await authAs(app, 'admin');
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]! });

    const created = await request(app)
      .post(`/api/v1/vehicles/${v.id}/maintenance`)
      .set(...s.auth)
      .send({ title: 'Rear brake slipping', severity: 'high' });

    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('open');
    expect(created.body.data.severity).toBe('high');

    const list = await request(app).get(`/api/v1/vehicles/${v.id}/maintenance`).set(...s.auth);
    expect(list.body.data).toHaveLength(1);
  });

  it('resolves a ticket and stamps resolvedAt', async () => {
    const s = await authAs(app, 'admin');
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]! });
    const created = await request(app)
      .post(`/api/v1/vehicles/${v.id}/maintenance`)
      .set(...s.auth)
      .send({ title: 'Flat tyre' });

    const res = await request(app)
      .patch(`/api/v1/maintenance/${created.body.data.id}`)
      .set(...s.auth)
      .send({ status: 'resolved' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('resolved');
    expect(res.body.data.resolvedAt).toEqual(expect.any(String));
  });

  it('404s for an unknown ticket', async () => {
    const s = await authAs(app, 'admin');
    const res = await request(app)
      .patch('/api/v1/maintenance/999999')
      .set(...s.auth)
      .send({ status: 'resolved' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MAINTENANCE_TICKET_NOT_FOUND');
  });

  it('denies a commuter opening a ticket', async () => {
    const s = await authAs(app, 'commuter');
    const v = await makeVehicle({ operatorId: ref.current.operatorIds[0]! });
    const res = await request(app)
      .post(`/api/v1/vehicles/${v.id}/maintenance`)
      .set(...s.auth)
      .send({ title: 'Something' });
    expect(res.status).toBe(403);
  });
});
