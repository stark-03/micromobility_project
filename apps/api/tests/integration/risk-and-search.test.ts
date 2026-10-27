import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { LngLat } from '@mm/shared-types';
import { createApp } from '../../src/app.ts';
import { sequelize } from '../../src/db/index.ts';
import { lineStringLiteral, pointLiteral } from '../../src/db/spatial.ts';
import { riskForSteps } from '../../src/modules/safety/service.ts';
import { useCleanDatabase } from '../helpers/clean-db.ts';
import { authAs } from '../helpers/auth-as.ts';

useCleanDatabase();
const app = createApp();

interface SegOpts {
  name: string;
  from: LngLat;
  to: LngLat;
  roadClass: string;
  lit: boolean;
  bikeLane: boolean;
  surface: number | null;
}

async function segment(o: SegOpts): Promise<string> {
  const [id] = await sequelize.query(
    `INSERT INTO road_segments
       (name, from_node, to_node, geometry, length_m, speed_free_kph, road_class,
        has_bike_lane, lit, surface_quality)
     VALUES (:name, :a, :b, ${lineStringLiteral([o.from, o.to]).val}, 500, 30, :cls, :lane, :lit, :surface)`,
    {
      replacements: {
        name: o.name,
        a: `${o.name}-a`,
        b: `${o.name}-b`,
        cls: o.roadClass,
        lane: o.bikeLane ? 1 : 0,
        lit: o.lit ? 1 : 0,
        surface: o.surface,
      },
    },
  );
  return String(id);
}

async function incident(segmentId: string, at: LngLat, severity: string, daysAgo = 30) {
  await sequelize.query(
    `INSERT INTO incidents (segment_id, occurred_at, location, severity, kind, source)
     VALUES (:seg, DATE_SUB(NOW(3), INTERVAL :d DAY), ${pointLiteral(at).val}, :sev, 'collision', 'test')`,
    { replacements: { seg: segmentId, d: daysAgo, sev: severity } },
  );
}

describe('route risk from the database', () => {
  it('reads accidents, surface, lighting and bike lanes for each segment on the route', async () => {
    const quiet = await segment({
      name: 'Quiet Lane',
      from: [74.5, 15.85],
      to: [74.504, 15.85],
      roadClass: 'cycleway',
      lit: true,
      bikeLane: true,
      surface: 5,
    });
    const busy = await segment({
      name: 'Busy Road',
      from: [74.5, 15.86],
      to: [74.504, 15.86],
      roadClass: 'arterial',
      lit: false,
      bikeLane: false,
      surface: 1,
    });
    await incident(busy, [74.502, 15.86], 'serious');
    await incident(busy, [74.502, 15.86], 'minor');

    const safe = await riskForSteps([{ segmentId: quiet, lengthM: 500, congestionIndex: 0 }]);
    const risky = await riskForSteps([{ segmentId: busy, lengthM: 500, congestionIndex: 0.7 }]);

    expect(safe.level).toBe('low');
    expect(risky.level).toBe('high');
    expect(risky.incidentCount).toBe(2);
    expect(risky.factors.lighting).toBe(100);
    expect(safe.factors.accidents).toBe(0);
  });

  it('forgets accidents older than the lookback window', async () => {
    const road = await segment({
      name: 'Old Crash Road',
      from: [74.5, 15.87],
      to: [74.504, 15.87],
      roadClass: 'local',
      lit: true,
      bikeLane: false,
      surface: 4,
    });
    await incident(road, [74.502, 15.87], 'fatal', 365 * 4);

    const r = await riskForSteps([{ segmentId: road, lengthM: 500, congestionIndex: 0 }]);
    expect(r.incidentCount).toBe(0);
  });
});

describe('GET /geo/search', () => {
  it('finds localities, streets and stations by name, prefix matches first', async () => {
    const s = await authAs(app, 'commuter');
    await segment({
      name: 'Camp Road',
      from: [74.508, 15.86],
      to: [74.51, 15.86],
      roadClass: 'collector',
      lit: true,
      bikeLane: false,
      surface: 3,
    });
    await sequelize.query(
      `INSERT INTO rental_stations (code, name, location) VALUES ('RS-T', 'Camp Market', ${pointLiteral([74.5108, 15.8607]).val})`,
    );

    const res = await request(app)
      .get('/api/v1/geo/search?q=camp')
      .set(...s.auth);
    expect(res.status).toBe(200);
    const kinds = res.body.data.map((p: { kind: string }) => p.kind);
    expect(kinds).toEqual(expect.arrayContaining(['zone', 'street', 'rental_station']));
    // Every result can be routed to.
    for (const p of res.body.data) expect(p.location).toHaveLength(2);
    // "Camp…" names all start with the term; the station outranks the street.
    expect(kinds.indexOf('rental_station')).toBeLessThan(kinds.indexOf('street'));
  });

  it('treats LIKE wildcards in the query as literal characters', async () => {
    const s = await authAs(app, 'commuter');
    const res = await request(app)
      .get('/api/v1/geo/search?q=%25%25')
      .set(...s.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('includes only the rider’s own saved places', async () => {
    const me = await authAs(app, 'commuter');
    const other = await authAs(app, 'commuter');
    await request(app)
      .post('/api/v1/users/me/places')
      .set(...other.auth)
      .send({ label: 'Secret Home', position: [74.5, 15.85], kind: 'home' });

    const res = await request(app)
      .get('/api/v1/geo/search?q=secret')
      .set(...me.auth);
    expect(res.body.data).toEqual([]);
  });
});
