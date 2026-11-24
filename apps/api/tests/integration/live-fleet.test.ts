import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as connect } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LngLat } from '@mm/shared-types';
import { createApp } from '../../src/app.ts';
import { sequelize } from '../../src/db/index.ts';
import { pointLiteral } from '../../src/db/spatial.ts';
import { attachGateway, closeGateway } from '../../src/realtime/gateway.ts';
import { useCleanDatabase } from '../helpers/clean-db.ts';
import { authAs } from '../helpers/auth-as.ts';
import { makeVehicle } from '../helpers/fixtures.ts';

const ref = useCleanDatabase();
const app = createApp();

const FORT: LngLat = [74.4968, 15.8517];
const MOVED: LngLat = [74.4975, 15.8522];

let server: http.Server;
let port: number;
const sockets: Socket[] = [];

beforeEach(async () => {
  server = http.createServer(app);
  attachGateway(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.disconnect();
  await closeGateway();
  await new Promise((resolve) => server.close(resolve));
});

/** A signed-in socket that records every event it receives. */
async function listen(token: string): Promise<{ events: Array<[string, unknown]> }> {
  const socket = connect(`http://127.0.0.1:${port}`, { auth: { token }, transports: ['websocket'] });
  sockets.push(socket);
  const events: Array<[string, unknown]> = [];
  socket.onAny((name: string, payload: unknown) => events.push([name, payload]));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  // The server joins its rooms just after the connect event; let that land.
  await new Promise((r) => setTimeout(r, 50));
  return { events };
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
}

async function vehicleFor(operatorIndex: number) {
  const v = await makeVehicle({ operatorId: ref.current.operatorIds[operatorIndex]! });
  await sequelize.query(
    `UPDATE vehicles SET last_position = ${pointLiteral(FORT).val} WHERE id = :id`,
    { replacements: { id: String(v.id) } },
  );
  return v;
}

describe('the live fleet feed', () => {
  it('tells staff the moment a rider takes a vehicle, and who may know what', async () => {
    const rider = await authAs(app, 'commuter');
    const admin = await authAs(app, 'admin');
    const sameOperator = await authAs(app, 'operator', { operatorId: ref.current.operatorIds[0]! });
    const otherOperator = await authAs(app, 'operator', { operatorId: ref.current.operatorIds[1]! });
    const v = await vehicleFor(0);

    const adminFeed = await listen(admin.accessToken);
    const sameFeed = await listen(sameOperator.accessToken);
    const otherFeed = await listen(otherOperator.accessToken);
    const riderFeed = await listen(rider.accessToken);

    const start = await request(app)
      .post('/api/v1/rentals')
      .set(...rider.auth)
      .send({ unlockCode: v.unlock_code });
    expect(start.status).toBe(201);

    await until(() => adminFeed.events.some(([n]) => n === 'vehicle:status'));
    const status = adminFeed.events.find(([n]) => n === 'vehicle:status')![1];
    expect(status).toMatchObject({ vehicleId: String(v.id), from: 'available', to: 'in_use' });

    await request(app)
      .post(`/api/v1/rentals/${start.body.data.id}/track`)
      .set(...rider.auth)
      .send({ position: MOVED, source: 'simulated' });
    await until(() => adminFeed.events.some(([n]) => n === 'vehicle:position'));
    expect(adminFeed.events.find(([n]) => n === 'vehicle:position')![1]).toMatchObject({
      vehicleId: String(v.id),
      position: MOVED,
    });

    await until(() => riderFeed.events.some(([n]) => n === 'stations:changed'));
    await new Promise((r) => setTimeout(r, 100));

    // The vehicle's own operator sees it; another company does not.
    expect(sameFeed.events.map(([n]) => n)).toContain('vehicle:status');
    expect(otherFeed.events.map(([n]) => n)).not.toContain('vehicle:status');
    expect(otherFeed.events.map(([n]) => n)).not.toContain('vehicle:position');

    // A rider learns that station counts moved, never whose vehicle went where.
    expect(riderFeed.events.map(([n]) => n)).toContain('stations:changed');
    expect(riderFeed.events.map(([n]) => n)).not.toContain('vehicle:status');
    expect(riderFeed.events.map(([n]) => n)).not.toContain('vehicle:position');
  });
});

describe('the Fleet screen data', () => {
  it('shows who is riding to an admin, that someone is to a planner', async () => {
    const rider = await authAs(app, 'commuter');
    const admin = await authAs(app, 'admin');
    const planner = await authAs(app, 'planner');
    const v = await vehicleFor(0);
    await request(app).post('/api/v1/rentals').set(...rider.auth).send({ unlockCode: v.unlock_code });

    const asAdmin = await request(app).get(`/api/v1/vehicles/${v.id}`).set(...admin.auth);
    expect(asAdmin.body.data.status).toBe('in_use');
    expect(asAdmin.body.data.activeRental.riderName).toBe(rider.user.fullName);
    expect(asAdmin.body.data.unlockCode).toBe(v.unlock_code);

    const list = await request(app).get('/api/v1/vehicles').set(...planner.auth);
    const row = list.body.data.find((x: { id: string }) => x.id === String(v.id));
    expect(row.activeRental).toMatchObject({ riderName: null });
    expect(row.activeRental.startedAt).toBeTruthy();
    expect(row.unlockCode).toBeNull();
  });

  it('counts the fleet by status, scoped to an operator’s own vehicles', async () => {
    const rider = await authAs(app, 'commuter');
    const admin = await authAs(app, 'admin');
    const operator = await authAs(app, 'operator', { operatorId: ref.current.operatorIds[1]! });
    const mine = await vehicleFor(1);
    await vehicleFor(0);
    await request(app).post('/api/v1/rentals').set(...rider.auth).send({ unlockCode: mine.unlock_code });

    const all = await request(app).get('/api/v1/vehicles/summary').set(...admin.auth);
    expect(all.body.data).toMatchObject({ total: 2, activeRentals: 1 });
    expect(all.body.data.byStatus).toMatchObject({ in_use: 1, available: 1, charging: 0 });

    const own = await request(app).get('/api/v1/vehicles/summary').set(...operator.auth);
    expect(own.body.data).toMatchObject({ total: 1, activeRentals: 1 });
  });

  it('stops counting a vehicle as rented once the ride ends', async () => {
    const rider = await authAs(app, 'commuter');
    const admin = await authAs(app, 'admin');
    const [stationId] = await sequelize.query(
      `INSERT INTO rental_stations (code, name, location) VALUES ('RS-F', 'Fort', ${pointLiteral(FORT).val})`,
    );
    const v = await vehicleFor(0);
    const start = await request(app).post('/api/v1/rentals').set(...rider.auth).send({ unlockCode: v.unlock_code });
    await request(app).post(`/api/v1/rentals/${start.body.data.id}/end`).set(...rider.auth).send({ position: FORT });

    const after = await request(app).get(`/api/v1/vehicles/${v.id}`).set(...admin.auth);
    expect(after.body.data.activeRental).toBeNull();
    expect(after.body.data.stationId).toBe(String(stationId));
    const summary = await request(app).get('/api/v1/vehicles/summary').set(...admin.auth);
    expect(summary.body.data.activeRentals).toBe(0);
  });
});
