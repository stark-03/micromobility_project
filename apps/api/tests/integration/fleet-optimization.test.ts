import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { sequelize } from '../../src/db/index.ts';
import { supplyAndDemand } from '../../src/modules/fleet/service.ts';
import { useCleanDatabase } from '../helpers/clean-db.ts';
import { authAs } from '../helpers/auth-as.ts';
import { makeVehicle } from '../helpers/fixtures.ts';

/**
 * M07 HTTP surface and the supply/demand model.
 *
 * The LP itself is covered by pytest, where it can be tested without a
 * database. What Express owns is the world it hands the solver — and the
 * allocation model below is the part most easily got wrong, because a plausible
 * but wrong target produces a plausible but wrong plan that crews then drive.
 */
const ref = useCleanDatabase();
const app = createApp();

describe('GET /fleet/supply-demand', () => {
  it('gives every zone a target share of the fleet that actually exists', async () => {
    const s = await authAs(app, 'planner');
    const op = ref.current.operatorIds[0]!;
    for (const code of ['CMP', 'CMP', 'CMP', 'TLK']) {
      await makeVehicle({ operatorId: op, homeZoneId: ref.current.zoneIdByCode.get(code)!, status: 'available' });
    }

    const res = await request(app).get('/api/v1/fleet/supply-demand').set(...s.auth);
    expect(res.status).toBe(200);

    const zones = res.body.data as { supply: number; targetVehicles: number; gap: number }[];
    expect(zones.length).toBeGreaterThan(0);

    const totalSupply = zones.reduce((n, z) => n + z.supply, 0);
    const totalTarget = zones.reduce((n, z) => n + z.targetVehicles, 0);

    // The targets must allocate the fleet that exists — no more, no less.
    // Targeting raw trip demand would have every zone short at once and the
    // optimiser would correctly find nothing to move.
    expect(totalTarget).toBeCloseTo(totalSupply, 1);
  });

  it('gaps sum to zero, so a surplus somewhere is a deficit somewhere else', async () => {
    const op = ref.current.operatorIds[0]!;
    for (const code of ['CMP', 'CMP', 'CMP', 'CMP', 'VDG']) {
      await makeVehicle({ operatorId: op, homeZoneId: ref.current.zoneIdByCode.get(code)!, status: 'available' });
    }

    const zones = await supplyAndDemand(2);
    const sum = zones.reduce((n, z) => n + z.gap, 0);
    expect(Math.abs(sum)).toBeLessThan(0.05);
  });

  it('counts only vehicles that are actually available', async () => {
    const op = ref.current.operatorIds[0]!;
    const zone = ref.current.zoneIdByCode.get('CMP')!;
    await makeVehicle({ operatorId: op, homeZoneId: zone, status: 'available' });
    // A vehicle mid-ride or in the workshop cannot be relocated by a van.
    await makeVehicle({ operatorId: op, homeZoneId: zone, status: 'in_use' });
    await makeVehicle({ operatorId: op, homeZoneId: zone, status: 'maintenance' });

    const zones = await supplyAndDemand(2);
    expect(zones.find((z) => z.zoneId === String(zone))!.supply).toBe(1);
  });

  it('filters to one zone when asked', async () => {
    const s = await authAs(app, 'planner');
    const zone = String(ref.current.zoneIdByCode.get('TLK')!);
    const res = await request(app)
      .get(`/api/v1/fleet/supply-demand?zoneId=${zone}`)
      .set(...s.auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].zoneId).toBe(zone);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/fleet/supply-demand')).status).toBe(401);
  });
});

describe('POST /fleet/rebalance/plan', () => {
  it('refuses a commuter — dispatching crews is operational work', async () => {
    const s = await authAs(app, 'commuter');
    const res = await request(app).post('/api/v1/fleet/rebalance/plan').set(...s.auth).send({});
    expect(res.status).toBe(403);
  });

  it.each([
    ['a negative van count', { vanCount: -1 }],
    ['an absurd horizon', { horizonHours: 500 }],
    ['zero van capacity', { vanCapacity: 0 }],
  ])('rejects %s', async (_label, patch) => {
    const s = await authAs(app, 'operator');
    const res = await request(app)
      .post('/api/v1/fleet/rebalance/plan')
      .set(...s.auth)
      .send(patch);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /fleet/rebalance/plans/:id', () => {
  it('404s with a stable code', async () => {
    const s = await authAs(app, 'planner');
    const res = await request(app).get('/api/v1/fleet/rebalance/plans/999999').set(...s.auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PLAN_NOT_FOUND');
  });
});

describe('PATCH /fleet/rebalance/tasks/:id', () => {
  async function seedPlanWithTasks(userId: string, zoneA: string, zoneB: string) {
    const [planId] = await sequelize.query(
      `INSERT INTO rebalance_plans
         (status, horizon_hours, van_count, van_capacity, total_vehicles, created_by)
       VALUES ('planned', 2, 2, 8, 3, :user)`,
      { replacements: { user: userId } },
    );
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const [taskId] = await sequelize.query(
        `INSERT INTO rebalance_tasks (plan_id, sequence, from_zone_id, to_zone_id, vehicles, distance_km)
         VALUES (:plan, :seq, :from, :to, 1, 2.5)`,
        { replacements: { plan: String(planId), seq: i + 1, from: zoneA, to: zoneB } },
      );
      ids.push(String(taskId));
    }
    return { planId: String(planId), taskIds: ids };
  }

  it('marks a task done and moves the plan to in_progress', async () => {
    const s = await authAs(app, 'operator');
    const { planId, taskIds } = await seedPlanWithTasks(
      s.user.id,
      String(ref.current.zoneIdByCode.get('CMP')!),
      String(ref.current.zoneIdByCode.get('VDG')!),
    );

    const res = await request(app)
      .patch(`/api/v1/fleet/rebalance/tasks/${taskIds[0]}`)
      .set(...s.auth)
      .send({ status: 'done' });
    expect(res.status).toBe(200);

    const plan = await request(app).get(`/api/v1/fleet/rebalance/plans/${planId}`).set(...s.auth);
    expect(plan.body.data.status).toBe('in_progress');
    expect(plan.body.data.tasks[0].status).toBe('done');
    expect(plan.body.data.tasks[0].completedAt).not.toBeNull();
  });

  it('completes the plan once nothing is outstanding', async () => {
    const s = await authAs(app, 'operator');
    const { planId, taskIds } = await seedPlanWithTasks(
      s.user.id,
      String(ref.current.zoneIdByCode.get('CMP')!),
      String(ref.current.zoneIdByCode.get('VDG')!),
    );

    await request(app).patch(`/api/v1/fleet/rebalance/tasks/${taskIds[0]}`).set(...s.auth).send({ status: 'done' });
    // A skipped task is resolved too — a crew that cannot do a drop has still
    // finished with it, and a plan stuck at in_progress forever is a bug.
    await request(app).patch(`/api/v1/fleet/rebalance/tasks/${taskIds[1]}`).set(...s.auth).send({ status: 'skipped' });

    const plan = await request(app).get(`/api/v1/fleet/rebalance/plans/${planId}`).set(...s.auth);
    expect(plan.body.data.status).toBe('completed');
  });

  it('404s for an unknown task', async () => {
    const s = await authAs(app, 'operator');
    const res = await request(app)
      .patch('/api/v1/fleet/rebalance/tasks/999999')
      .set(...s.auth)
      .send({ status: 'done' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TASK_NOT_FOUND');
  });

  it('rejects an invented status', async () => {
    const s = await authAs(app, 'operator');
    const res = await request(app)
      .patch('/api/v1/fleet/rebalance/tasks/1')
      .set(...s.auth)
      .send({ status: 'teleported' });
    expect(res.status).toBe(400);
  });
});
