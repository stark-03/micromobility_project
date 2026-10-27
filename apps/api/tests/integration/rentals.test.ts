import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { QueryTypes } from 'sequelize';
import type { LngLat } from '@mm/shared-types';
import { createApp } from '../../src/app.ts';
import { sequelize } from '../../src/db/index.ts';
import { pointLiteral } from '../../src/db/spatial.ts';
import { setPaymentGatewayForTests } from '../../src/modules/rentals/payment-gateway.ts';
import { useCleanDatabase } from '../helpers/clean-db.ts';
import { authAs } from '../helpers/auth-as.ts';
import { makeVehicle } from '../helpers/fixtures.ts';

const ref = useCleanDatabase();
const app = createApp();

const CAMP: LngLat = [74.5108, 15.8607];
const FORT: LngLat = [74.4968, 15.8517];
/** ~800 m from Camp: inside walking distance. */
const NEAR_CAMP: LngLat = [74.504, 15.858];
/** ~1.5 km from both stations. */
const NOWHERE: LngLat = [74.52, 15.873];

afterEach(() => setPaymentGatewayForTests(null));

async function makeStation(code: string, at: LngLat, capacity = 10): Promise<string> {
  const [id] = await sequelize.query(
    `INSERT INTO rental_stations (code, name, location, capacity, return_radius_m)
     VALUES (:code, :name, ${pointLiteral(at).val}, :capacity, 150)`,
    { replacements: { code, name: `${code} station`, capacity } },
  );
  return String(id);
}

async function dock(
  stationId: string | null,
  at: LngLat,
  opts: { type?: string; battery?: number | null; status?: string } = {},
) {
  const v = await makeVehicle({
    operatorId: ref.current.operatorIds[0]!,
    homeZoneId: String(ref.current.zoneIdByCode.get('CMP')!),
    type: (opts.type ?? 'scooter') as never,
    status: (opts.status ?? 'available') as never,
    batteryPct: opts.battery === undefined ? 90 : opts.battery,
  });
  await sequelize.query(
    `UPDATE vehicles SET station_id = :station, last_position = ${pointLiteral(at).val} WHERE id = :id`,
    { replacements: { station: stationId, id: String(v.id) } },
  );
  return { id: String(v.id), code: v.unlock_code! };
}

/** Moves the clock: pretend the ride started `seconds` ago. */
async function backdate(tripId: string, seconds: number) {
  await sequelize.query(
    'UPDATE trips SET started_at = DATE_SUB(NOW(3), INTERVAL :s SECOND) WHERE id = :id',
    { replacements: { s: seconds, id: tripId } },
  );
}

async function vehicleState(id: string) {
  const [row] = await sequelize.query<{
    status: string;
    station_id: string | null;
    battery_pct: number | null;
  }>('SELECT status, station_id, battery_pct FROM vehicles WHERE id = :id', {
    replacements: { id },
    type: QueryTypes.SELECT,
  });
  return row!;
}

describe('every vehicle has a QR unlock code', () => {
  it('assigns an 8-character code from the unambiguous alphabet on creation', async () => {
    const a = await dock(null, CAMP);
    const b = await dock(null, CAMP);
    expect(a.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(a.code).not.toBe(b.code);
  });
});

describe('GET /stations/near', () => {
  it('reports rentable and unavailable vehicles by type, and free docks', async () => {
    const s = await authAs(app, 'commuter');
    const camp = await makeStation('RS-CAMP', CAMP, 6);
    await dock(camp, CAMP, { type: 'scooter', battery: 80 });
    await dock(camp, CAMP, { type: 'scooter', battery: 10 }); // too flat to rent
    await dock(camp, CAMP, { type: 'ebike', battery: 70, status: 'charging' });
    await dock(camp, CAMP, { type: 'bike', battery: null });

    const res = await request(app)
      .get(`/api/v1/stations/near?lng=${CAMP[0]}&lat=${CAMP[1]}&radiusM=500`)
      .set(...s.auth);

    expect(res.status).toBe(200);
    const st = res.body.data[0];
    const inv = Object.fromEntries(st.inventory.map((i: { type: string }) => [i.type, i]));
    expect(inv.scooter).toEqual({ type: 'scooter', rentable: 1, unavailable: 1 });
    expect(inv.ebike).toEqual({ type: 'ebike', rentable: 0, unavailable: 1 });
    expect(inv.bike).toEqual({ type: 'bike', rentable: 1, unavailable: 0 });
    expect(inv.ev).toEqual({ type: 'ev', rentable: 0, unavailable: 0 });
    expect(st.rentableTotal).toBe(2);
    expect(st.freeDocks).toBe(2);
    expect(st.distanceM).toBeLessThan(5);
  });

  it('shows battery percentage, capacity and range per vehicle on the station detail', async () => {
    const s = await authAs(app, 'commuter');
    const camp = await makeStation('RS-CAMP', CAMP);
    await dock(camp, CAMP, { type: 'ebike', battery: 50 });

    const res = await request(app)
      .get(`/api/v1/stations/${camp}`)
      .set(...s.auth);
    expect(res.body.data.vehicles[0].battery).toEqual({ pct: 50, capacityWh: 500, rangeM: 22500 });
  });
});

describe('a rental, end to end', () => {
  it('unlocks by code, tracks the ride, returns at a station and charges the fare', async () => {
    const s = await authAs(app, 'commuter');
    const fort = await makeStation('RS-FORT', FORT);
    const camp = await makeStation('RS-CAMP', CAMP);
    const v = await dock(fort, FORT, { type: 'scooter', battery: 90 });

    // ---- unlock -------------------------------------------------------------
    const start = await request(app)
      .post('/api/v1/rentals')
      .set(...s.auth)
      .send({ unlockCode: v.code.toLowerCase() }); // codes are case-insensitive
    expect(start.status).toBe(201);
    const rental = start.body.data;
    expect(rental.status).toBe('active');
    expect(rental.startStation.id).toBe(fort);
    expect(rental.plan.vehicleType).toBe('scooter');
    expect(await vehicleState(v.id)).toMatchObject({ status: 'in_use', station_id: null });

    // The station no longer counts it.
    const fortNow = await request(app)
      .get(`/api/v1/stations/${fort}`)
      .set(...s.auth);
    expect(fortNow.body.data.rentableTotal).toBe(0);

    // ---- ride: three GPS fixes toward Camp ----------------------------------
    const waypoints: LngLat[] = [
      [74.5003, 15.854],
      [74.5056, 15.8575],
      [74.51, 15.8603],
    ];
    for (const p of waypoints) {
      const t = await request(app)
        .post(`/api/v1/rentals/${rental.id}/track`)
        .set(...s.auth)
        .send({ position: p, source: 'simulated' });
      expect(t.status).toBe(200);
    }
    const active = await request(app)
      .get('/api/v1/rentals/active')
      .set(...s.auth);
    expect(active.body.data.distanceM).toBeGreaterThan(1300);
    expect(active.body.data.path).toHaveLength(4); // start + 3 fixes
    // The battery drained with the distance ridden.
    expect(active.body.data.vehicle.battery.pct).toBeLessThan(90);

    // ---- return -------------------------------------------------------------
    await backdate(rental.id, 7 * 60 + 5);
    const end = await request(app)
      .post(`/api/v1/rentals/${rental.id}/end`)
      .set(...s.auth)
      .send({ position: CAMP });
    expect(end.status).toBe(200);
    const done = end.body.data;
    expect(done.status).toBe('completed');
    expect(done.endStation.id).toBe(camp);
    // 8 billed minutes (7m05s rounds up) on ₹10 + ₹2/min.
    expect(done.fare.minutes).toBe(8);
    expect(done.fare.totalMinor).toBe(1000 + 8 * 200);
    expect(done.payment).toMatchObject({
      status: 'succeeded',
      provider: 'mock',
      amountMinor: 2600,
    });
    expect(done.payment.providerRef).toMatch(/^mock_pay_/);
    expect(done.co2SavedG).toBeGreaterThan(0);

    // Docked at Camp, available again, history walked through `returning`.
    expect(await vehicleState(v.id)).toMatchObject({ status: 'available', station_id: camp });
    const history = await sequelize.query<{ to_status: string }>(
      'SELECT to_status FROM vehicle_status_history WHERE vehicle_id = :id ORDER BY id',
      { replacements: { id: v.id }, type: QueryTypes.SELECT },
    );
    expect(history.map((h) => h.to_status)).toEqual(['in_use', 'returning', 'available']);

    // ---- receipt, history, eco summary --------------------------------------
    const receipt = await request(app)
      .get(`/api/v1/rentals/${rental.id}/receipt`)
      .set(...s.auth);
    expect(receipt.status).toBe(200);
    expect(receipt.body.data.receiptNo).toMatch(/^RCPT-\d{8}-\d{6}$/);
    expect(receipt.body.data.rental.fare.totalMinor).toBe(2600);

    const list = await request(app)
      .get('/api/v1/rentals')
      .set(...s.auth);
    expect(list.body.data.map((r: { id: string }) => r.id)).toContain(rental.id);

    const eco = await request(app)
      .get('/api/v1/rentals/eco-summary')
      .set(...s.auth);
    expect(eco.body.data).toMatchObject({ trips: 1, spentMinor: 2600, currency: 'INR' });
    expect(eco.body.data.co2SavedKg).toBeGreaterThan(0);
  });

  it('ignores a GPS jump no rider could have made, but keeps the fix', async () => {
    const s = await authAs(app, 'commuter');
    const v = await dock(null, FORT);
    const start = await request(app)
      .post('/api/v1/rentals')
      .set(...s.auth)
      .send({ unlockCode: v.code });

    // Camp is ~1.8 km from Fort; claiming it a moment after unlocking is ~1000 km/h.
    const res = await request(app)
      .post(`/api/v1/rentals/${start.body.data.id}/track`)
      .set(...s.auth)
      .send({ position: CAMP, source: 'gps' });

    expect(res.body.data.distanceM).toBe(0);
    expect(res.body.data.path).toHaveLength(2);
  });

  it('refuses a return away from any station, and says where the nearest one is', async () => {
    const s = await authAs(app, 'commuter');
    const fort = await makeStation('RS-FORT', FORT);
    const v = await dock(fort, FORT);
    const start = await request(app)
      .post('/api/v1/rentals')
      .set(...s.auth)
      .send({ unlockCode: v.code });

    const end = await request(app)
      .post(`/api/v1/rentals/${start.body.data.id}/end`)
      .set(...s.auth)
      .send({ position: NOWHERE });

    expect(end.status).toBe(422);
    expect(end.body.error.code).toBe('RETURN_NOT_AT_STATION');
    expect(
      end.body.error.details.find((d: { path: string }) => d.path === 'stationId').message,
    ).toBe(fort);
    // Still riding: an unverified return must not free the vehicle.
    expect(await vehicleState(v.id)).toMatchObject({ status: 'in_use' });
  });

  it('refuses a return to a full station', async () => {
    const s = await authAs(app, 'commuter');
    const full = await makeStation('RS-FULL', CAMP, 1);
    await dock(full, CAMP); // takes the only dock
    const fort = await makeStation('RS-FORT', FORT);
    const v = await dock(fort, FORT);
    const start = await request(app)
      .post('/api/v1/rentals')
      .set(...s.auth)
      .send({ unlockCode: v.code });

    const end = await request(app)
      .post(`/api/v1/rentals/${start.body.data.id}/end`)
      .set(...s.auth)
      .send({ position: CAMP });
    expect(end.status).toBe(409);
    expect(end.body.error.code).toBe('STATION_FULL');
  });

  it('sends a vehicle returned nearly flat to charging, not back to available', async () => {
    const s = await authAs(app, 'commuter');
    const fort = await makeStation('RS-FORT', FORT);
    const v = await dock(fort, FORT, { battery: 18 });
    const start = await request(app)
      .post('/api/v1/rentals')
      .set(...s.auth)
      .send({ unlockCode: v.code });
    await request(app)
      .post(`/api/v1/rentals/${start.body.data.id}/end`)
      .set(...s.auth)
      .send({ position: FORT });
    expect(await vehicleState(v.id)).toMatchObject({ status: 'charging', station_id: fort });
  });
});

describe('unlock rules', () => {
  it('will not rent a vehicle that is charging or too flat', async () => {
    const s = await authAs(app, 'commuter');
    const charging = await dock(null, CAMP, { status: 'charging' });
    const flat = await dock(null, CAMP, { battery: 5 });

    for (const v of [charging, flat]) {
      const res = await request(app)
        .post('/api/v1/rentals')
        .set(...s.auth)
        .send({ unlockCode: v.code });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VEHICLE_NOT_RENTABLE');
    }
  });

  it('allows one ride at a time per rider', async () => {
    const s = await authAs(app, 'commuter');
    const a = await dock(null, CAMP);
    const b = await dock(null, CAMP);
    await request(app)
      .post('/api/v1/rentals')
      .set(...s.auth)
      .send({ unlockCode: a.code });

    const second = await request(app)
      .post('/api/v1/rentals')
      .set(...s.auth)
      .send({ unlockCode: b.code });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('RENTAL_ALREADY_ACTIVE');
    expect(await vehicleState(b.id)).toMatchObject({ status: 'available' });
  });

  it('does not let a second rider take a vehicle already in use', async () => {
    const one = await authAs(app, 'commuter');
    const two = await authAs(app, 'commuter');
    const v = await dock(null, CAMP);
    await request(app)
      .post('/api/v1/rentals')
      .set(...one.auth)
      .send({ unlockCode: v.code });

    const res = await request(app)
      .post('/api/v1/rentals')
      .set(...two.auth)
      .send({ unlockCode: v.code });
    expect(res.body.error.code).toBe('VEHICLE_NOT_RENTABLE');
  });

  it('hides one rider’s rental from another', async () => {
    const one = await authAs(app, 'commuter');
    const two = await authAs(app, 'commuter');
    const v = await dock(null, CAMP);
    const start = await request(app)
      .post('/api/v1/rentals')
      .set(...one.auth)
      .send({ unlockCode: v.code });

    const peek = await request(app)
      .get(`/api/v1/rentals/${start.body.data.id}`)
      .set(...two.auth);
    expect(peek.status).toBe(404);
    const track = await request(app)
      .post(`/api/v1/rentals/${start.body.data.id}/track`)
      .set(...two.auth)
      .send({ position: CAMP });
    expect(track.status).toBe(404);
  });
});

describe('payments', () => {
  it('ends the ride even when the payment fails, and lets the rider retry', async () => {
    const s = await authAs(app, 'commuter');
    const fort = await makeStation('RS-FORT', FORT);
    const v = await dock(fort, FORT);
    setPaymentGatewayForTests({
      name: 'mock',
      charge: async () => ({ status: 'failed', providerRef: null, failureReason: 'Declined' }),
    });

    const start = await request(app)
      .post('/api/v1/rentals')
      .set(...s.auth)
      .send({ unlockCode: v.code });
    const end = await request(app)
      .post(`/api/v1/rentals/${start.body.data.id}/end`)
      .set(...s.auth)
      .send({ position: FORT });
    expect(end.body.data.status).toBe('completed');
    expect(end.body.data.payment.status).toBe('failed');

    setPaymentGatewayForTests(null);
    const retry = await request(app)
      .post(`/api/v1/rentals/${start.body.data.id}/pay`)
      .set(...s.auth);
    expect(retry.status).toBe(200);
    expect(retry.body.data.payment.status).toBe('succeeded');
  });
});

describe('GET /rentals/preview', () => {
  it('shows the scanned vehicle, its tariff and whether it can be rented', async () => {
    const s = await authAs(app, 'commuter');
    const camp = await makeStation('RS-CAMP', CAMP);
    const ok = await dock(camp, CAMP, { type: 'ebike', battery: 60 });
    const flat = await dock(camp, CAMP, { type: 'scooter', battery: 9 });

    const good = await request(app)
      .get(`/api/v1/rentals/preview?code=${ok.code}`)
      .set(...s.auth);
    expect(good.status).toBe(200);
    expect(good.body.data).toMatchObject({
      stationName: 'RS-CAMP station',
      notRentableReason: null,
      plan: { vehicleType: 'ebike', unlockFeeMinor: 1000, perMinuteMinor: 150 },
      vehicle: { rentable: true, battery: { pct: 60, capacityWh: 500, rangeM: 27000 } },
    });

    const bad = await request(app)
      .get(`/api/v1/rentals/preview?code=${flat.code}`)
      .set(...s.auth);
    expect(bad.body.data.vehicle.rentable).toBe(false);
    expect(bad.body.data.notRentableReason).toMatch(/9%/);
  });

  it('returns 404 for a code no vehicle has', async () => {
    const s = await authAs(app, 'commuter');
    const res = await request(app)
      .get('/api/v1/rentals/preview?code=ZZZZZZZZ')
      .set(...s.auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('VEHICLE_NOT_FOUND');
  });
});

describe('quotes and recommendations', () => {
  it('estimates the fare before the journey begins', async () => {
    const s = await authAs(app, 'commuter');
    const res = await request(app)
      .get('/api/v1/rentals/estimate?vehicleType=ebike&distanceM=4000')
      .set(...s.auth);
    expect(res.status).toBe(200);
    // 4 km at 20 km/h is 12 minutes: ₹10 + 12 × ₹1.50.
    expect(res.body.data.fare).toMatchObject({ minutes: 12, totalMinor: 1000 + 12 * 150 });
  });

  it('suggests another station when the nearest has nothing to rent', async () => {
    const s = await authAs(app, 'commuter');
    const empty = await makeStation('RS-EMPTY', CAMP);
    const other = await makeStation('RS-OTHER', NEAR_CAMP);
    await dock(empty, CAMP, { status: 'maintenance' });
    await dock(other, NEAR_CAMP, { type: 'ebike', battery: 95 });

    const res = await request(app)
      .post('/api/v1/rentals/recommend')
      .set(...s.auth)
      .send({ origin: CAMP, destination: [74.506, 15.8395] });

    expect(res.status).toBe(200);
    expect(res.body.data.nearestStation.id).toBe(empty);
    expect(res.body.data.nearestStationNote).toMatch(/no vehicles available/);
    expect(res.body.data.recommendations[0]).toMatchObject({
      vehicleType: 'ebike',
      alternative: true,
    });
    expect(res.body.data.recommendations[0].station.id).toBe(other);
    expect(res.body.data.tripDistanceM).toBeGreaterThan(0);
  });
});
