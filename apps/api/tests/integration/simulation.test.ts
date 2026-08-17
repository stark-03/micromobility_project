import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { Scenario, SimulationMetric, SimulationRun } from '../../src/db/models/index.ts';
import { compareMetrics } from '../../src/modules/simulation/service.ts';
import { useCleanDatabase } from '../helpers/clean-db.ts';
import { authAs } from '../helpers/auth-as.ts';

/**
 * M06 HTTP surface.
 *
 * These do NOT drive the SimPy engine — that lives behind the ML service and is
 * covered by pytest, where it can be tested without a socket, a database or an
 * HTTP boundary in the way. What is tested here is everything Express owns:
 * authorization, validation, the run lifecycle, and the shape of what comes
 * back. `executeRun` is exercised separately as a job.
 */
useCleanDatabase();
const app = createApp();

function scenarioBody(extra: Record<string, unknown> = {}) {
  return {
    name: `Scenario ${Math.random().toString(36).slice(2, 8)}`,
    simHours: 6,
    startHour: 7,
    fleet: { scooter: 40, ebike: 20, bike: 10 },
    weather: { precipitationMm: 0, tempC: 27 },
    policy: { bikeLaneZones: [], closedZones: [], demandMultiplier: 1 },
    ...extra,
  };
}

async function createScenarioVia(auth: [string, string], extra: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/v1/scenarios').set(...auth).send(scenarioBody(extra));
  expect(res.status).toBe(201);
  return res.body.data as { id: string; name: string };
}

describe('POST /scenarios', () => {
  it('creates a scenario with defaults filled in', async () => {
    const s = await authAs(app, 'planner');
    const res = await request(app)
      .post('/api/v1/scenarios')
      .set(...s.auth)
      .send(scenarioBody({ name: 'Bike lanes on Congress Road' }));

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Bike lanes on Congress Road');
    expect(res.body.data.runCount).toBe(0);
    expect(res.body.data.latestRun).toBeNull();
    expect(res.body.data.baselineRunId).toBeNull();
    // Unspecified levers must come back populated, not undefined — the builder
    // form binds to them directly.
    expect(res.body.data.policy.rebalanceEnabled).toBe(false);
    expect(res.body.data.policy.rebalanceIntervalMin).toBe(60);
  });

  it('rejects a commuter — defining city policy is a planning act', async () => {
    const s = await authAs(app, 'commuter');
    const res = await request(app).post('/api/v1/scenarios').set(...s.auth).send(scenarioBody());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/v1/scenarios').send(scenarioBody());
    expect(res.status).toBe(401);
  });

  it.each([
    ['a lever outside its range', { policy: { demandMultiplier: 99 } }],
    ['a negative fleet', { fleet: { scooter: -5, ebike: 0, bike: 0 } }],
    ['an out-of-range start hour', { startHour: 25 }],
    ['a blank name', { name: '   ' }],
    ['too long a run', { simHours: 500 }],
  ])('rejects %s at the boundary', async (_label, extra) => {
    const s = await authAs(app, 'planner');
    const res = await request(app)
      .post('/api/v1/scenarios')
      .set(...s.auth)
      .send(scenarioBody(extra));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /scenarios', () => {
  it('lists newest first with a run count', async () => {
    const s = await authAs(app, 'planner');
    await createScenarioVia(s.auth, { name: 'First' });
    await createScenarioVia(s.auth, { name: 'Second' });

    const res = await request(app).get('/api/v1/scenarios').set(...s.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data.every((x: { runCount: number }) => x.runCount === 0)).toBe(true);
  });

  it('is readable by any signed-in role', async () => {
    const s = await authAs(app, 'commuter');
    const res = await request(app).get('/api/v1/scenarios').set(...s.auth);
    expect(res.status).toBe(200);
  });
});

describe('POST /scenarios/:id/runs', () => {
  it('returns 202 with a queued run, never a result', async () => {
    const s = await authAs(app, 'planner');
    const scenario = await createScenarioVia(s.auth);

    const res = await request(app)
      .post(`/api/v1/scenarios/${scenario.id}/runs`)
      .set(...s.auth)
      .send({ seed: 1234 });

    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe('queued');
    expect(res.body.data.seed).toBe(1234);
    expect(res.body.data.progress).toBe(0);
    expect(res.body.data.metrics).toEqual({});
  });

  it('generates a seed when none is given', async () => {
    const s = await authAs(app, 'planner');
    const scenario = await createScenarioVia(s.auth);

    const res = await request(app)
      .post(`/api/v1/scenarios/${scenario.id}/runs`)
      .set(...s.auth)
      .send({});

    expect(res.status).toBe(202);
    expect(Number.isInteger(res.body.data.seed)).toBe(true);
  });

  it('404s for a scenario that does not exist', async () => {
    const s = await authAs(app, 'planner');
    const res = await request(app).post('/api/v1/scenarios/999999/runs').set(...s.auth).send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SCENARIO_NOT_FOUND');
  });

  it('refuses a commuter', async () => {
    const planner = await authAs(app, 'planner');
    const scenario = await createScenarioVia(planner.auth);

    const commuter = await authAs(app, 'commuter');
    const res = await request(app)
      .post(`/api/v1/scenarios/${scenario.id}/runs`)
      .set(...commuter.auth)
      .send({});

    expect(res.status).toBe(403);
  });
});

describe('GET /runs/:runId', () => {
  it('404s with a stable code for an unknown run', async () => {
    const s = await authAs(app, 'planner');
    const res = await request(app).get('/api/v1/runs/999999').set(...s.auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RUN_NOT_FOUND');
  });

  it('returns metrics assembled from the narrow table', async () => {
    const s = await authAs(app, 'planner');
    const scenario = await createScenarioVia(s.auth);
    const run = await SimulationRun.create({
      scenario_id: scenario.id,
      seed: 7,
      status: 'completed',
      created_by: s.user.id,
    });
    await SimulationMetric.bulkCreate([
      { run_id: String(run.id), metric_key: 'tripsServed', metric_value: '1503' },
      { run_id: String(run.id), metric_key: 'meanWaitSeconds', metric_value: '184.4000' },
    ]);

    const res = await request(app).get(`/api/v1/runs/${run.id}`).set(...s.auth);
    expect(res.status).toBe(200);
    // DECIMAL arrives from MySQL as a string; the DTO must hand back numbers.
    expect(res.body.data.metrics).toEqual({ tripsServed: 1503, meanWaitSeconds: 184.4 });
    expect(res.body.data.scenarioName).toBe(scenario.name);
  });
});

describe('POST /runs/compare', () => {
  async function completedRun(scenarioId: string, userId: string, metrics: Record<string, number>) {
    const run = await SimulationRun.create({
      scenario_id: scenarioId,
      seed: 1,
      status: 'completed',
      created_by: userId,
    });
    await SimulationMetric.bulkCreate(
      Object.entries(metrics).map(([metric_key, v]) => ({
        run_id: String(run.id),
        metric_key,
        metric_value: String(v),
      })),
    );
    return String(run.id);
  }

  it('returns direction-labelled deltas', async () => {
    const s = await authAs(app, 'planner');
    const scenario = await createScenarioVia(s.auth);
    const baseline = await completedRun(scenario.id, s.user.id, {
      tripsServed: 1000,
      tripsUnserved: 400,
      safetyIncidents: 5,
    });
    const variant = await completedRun(scenario.id, s.user.id, {
      tripsServed: 1200,
      tripsUnserved: 200,
      safetyIncidents: 3,
    });

    const res = await request(app)
      .post('/api/v1/runs/compare')
      .set(...s.auth)
      .send({ runIds: [baseline, variant] });

    expect(res.status).toBe(200);
    const rows = Object.fromEntries(
      res.body.data.rows.map((r: { metric: string }) => [r.metric, r]),
    );
    expect(rows.tripsServed.delta).toBe(200);
    expect(rows.tripsServed.direction).toBe('better');
    // Fewer unserved is an improvement even though the delta is negative.
    expect(rows.tripsUnserved.delta).toBe(-200);
    expect(rows.tripsUnserved.direction).toBe('better');
    expect(rows.safetyIncidents.direction).toBe('better');
    expect(rows.tripsUnserved.deltaPct).toBe(-50);
  });

  it('refuses to compare a run that has not completed', async () => {
    const s = await authAs(app, 'planner');
    const scenario = await createScenarioVia(s.auth);
    const done = await completedRun(scenario.id, s.user.id, { tripsServed: 10 });
    const queued = await SimulationRun.create({
      scenario_id: scenario.id,
      seed: 2,
      status: 'queued',
      created_by: s.user.id,
    });

    const res = await request(app)
      .post('/api/v1/runs/compare')
      .set(...s.auth)
      .send({ runIds: [done, String(queued.id)] });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RUN_NOT_COMPLETED');
  });

  it('requires exactly two run ids', async () => {
    const s = await authAs(app, 'planner');
    const res = await request(app)
      .post('/api/v1/runs/compare')
      .set(...s.auth)
      .send({ runIds: ['1'] });
    expect(res.status).toBe(400);
  });

  it('does not mistake /compare for a run id', async () => {
    // Route ordering regression: `/:runId` registered first would match
    // "compare" and 404 with RUN_NOT_FOUND instead of validating the body.
    const s = await authAs(app, 'planner');
    const res = await request(app).post('/api/v1/runs/compare').set(...s.auth).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /scenarios/:id/baseline', () => {
  it('sets a completed run as the baseline', async () => {
    const s = await authAs(app, 'planner');
    const scenario = await createScenarioVia(s.auth);
    const run = await SimulationRun.create({
      scenario_id: scenario.id,
      seed: 3,
      status: 'completed',
      created_by: s.user.id,
    });

    const res = await request(app)
      .post(`/api/v1/scenarios/${scenario.id}/baseline`)
      .set(...s.auth)
      .send({ runId: String(run.id) });

    expect(res.status).toBe(200);
    const reloaded = await Scenario.findByPk(scenario.id);
    expect(String(reloaded!.baseline_run_id)).toBe(String(run.id));
  });

  it('refuses a run belonging to another scenario', async () => {
    const s = await authAs(app, 'planner');
    const a = await createScenarioVia(s.auth);
    const b = await createScenarioVia(s.auth);
    const run = await SimulationRun.create({
      scenario_id: b.id,
      seed: 4,
      status: 'completed',
      created_by: s.user.id,
    });

    const res = await request(app)
      .post(`/api/v1/scenarios/${a.id}/baseline`)
      .set(...s.auth)
      .send({ runId: String(run.id) });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /scenarios/:id', () => {
  it('soft deletes so completed runs can still name their scenario', async () => {
    const s = await authAs(app, 'planner');
    const scenario = await createScenarioVia(s.auth);
    const run = await SimulationRun.create({
      scenario_id: scenario.id,
      seed: 5,
      status: 'completed',
      created_by: s.user.id,
    });

    expect((await request(app).delete(`/api/v1/scenarios/${scenario.id}`).set(...s.auth)).status).toBe(204);

    // Gone from the list...
    const list = await request(app).get('/api/v1/scenarios').set(...s.auth);
    expect(list.body.data.some((x: { id: string }) => x.id === scenario.id)).toBe(false);

    // ...but the run still resolves its name.
    const runRes = await request(app).get(`/api/v1/runs/${run.id}`).set(...s.auth);
    expect(runRes.status).toBe(200);
    expect(runRes.body.data.scenarioName).toBe(scenario.name);
  });
});

describe('compareMetrics', () => {
  it('skips metrics missing from either side rather than inventing zeros', () => {
    const rows = compareMetrics({ tripsServed: 10 }, { tripsServed: 20, co2AvoidedKg: 5 });
    expect(rows.map((r) => r.metric)).toEqual(['tripsServed']);
  });

  it('reports deltaPct as null when the baseline is zero', () => {
    const rows = compareMetrics({ tripsUnserved: 0 }, { tripsUnserved: 12 });
    expect(rows[0]!.deltaPct).toBeNull();
    expect(rows[0]!.direction).toBe('worse');
  });

  it('labels an unchanged metric "same"', () => {
    const rows = compareMetrics({ tripsServed: 7 }, { tripsServed: 7 });
    expect(rows[0]!.direction).toBe('same');
    expect(rows[0]!.delta).toBe(0);
  });
});
