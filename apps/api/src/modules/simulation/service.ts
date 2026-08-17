import { Op, QueryTypes } from 'sequelize';
import type {
  CompareRowDto,
  ScenarioDto,
  SimulationMetrics,
  SimulationRunDto,
  SimulationTimelinePointDto,
} from '@mm/shared-types';
import { sequelize } from '../../db/index.ts';
import { models } from '../../db/models/index.ts';
import { selectGeom, parsePoint } from '../../db/spatial.ts';
import { env } from '../../config/env.ts';
import { AppError } from '../../lib/errors.ts';
import { logger } from '../../lib/logger.ts';
import { publish } from '../../jobs/progress.ts';

const { Scenario, SimulationRun, SimulationMetric, SimulationEvent } = models;

/** Mirrors the ML service's PolicyLevers defaults. */
const DEFAULT_POLICY = {
  bikeLaneZones: [] as string[],
  closedZones: [] as string[],
  demandMultiplier: 1,
  rebalanceEnabled: false,
  rebalanceIntervalMin: 60,
  rebalanceVanCapacity: 8,
};

// ---- reads ------------------------------------------------------------------

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toRunDto(
  run: InstanceType<typeof SimulationRun>,
  metrics: SimulationMetrics,
  scenarioName: string | null,
): SimulationRunDto {
  return {
    id: String(run.id),
    scenarioId: String(run.scenario_id),
    scenarioName,
    seed: run.seed,
    status: run.status,
    progress: num(run.progress),
    startedAt: run.started_at?.toISOString() ?? null,
    finishedAt: run.finished_at?.toISOString() ?? null,
    durationMs: run.duration_ms ?? null,
    error: run.error ?? null,
    createdAt: run.created_at.toISOString(),
    metrics,
    detail: (run.detail as Record<string, unknown> | null) ?? null,
  };
}

async function metricsFor(runIds: string[]): Promise<Map<string, SimulationMetrics>> {
  const out = new Map<string, SimulationMetrics>();
  if (runIds.length === 0) return out;

  const rows = await SimulationMetric.findAll({ where: { run_id: { [Op.in]: runIds } } });
  for (const row of rows) {
    const key = String(row.run_id);
    const bucket = out.get(key) ?? {};
    bucket[row.metric_key] = num(row.metric_value);
    out.set(key, bucket);
  }
  return out;
}

export async function listScenarios(): Promise<ScenarioDto[]> {
  const scenarios = await Scenario.findAll({ order: [['created_at', 'DESC']], limit: 200 });
  if (scenarios.length === 0) return [];

  // One query for every scenario's newest run rather than N+1. A planner with
  // thirty scenarios should not cost thirty round trips to render a list.
  const latest = await sequelize.query<{ id: string }>(
    `SELECT r.id FROM simulation_runs r
       JOIN (
         SELECT scenario_id, MAX(created_at) AS newest
           FROM simulation_runs
          WHERE scenario_id IN (:ids)
          GROUP BY scenario_id
       ) newest_per_scenario
         ON r.scenario_id = newest_per_scenario.scenario_id
        AND r.created_at  = newest_per_scenario.newest`,
    { replacements: { ids: scenarios.map((s) => s.id) }, type: QueryTypes.SELECT },
  );

  const counts = await SimulationRun.findAll({
    attributes: ['scenario_id', [sequelize.fn('COUNT', sequelize.col('id')), 'n']],
    where: { scenario_id: { [Op.in]: scenarios.map((s) => String(s.id)) } },
    group: ['scenario_id'],
    raw: true,
  });
  const countBy = new Map(
    (counts as unknown as { scenario_id: string; n: number }[]).map((c) => [
      String(c.scenario_id),
      Number(c.n),
    ]),
  );

  const runs = await SimulationRun.findAll({
    where: { id: { [Op.in]: latest.map((l) => l.id) } },
  });
  const runMetrics = await metricsFor(runs.map((r) => String(r.id)));
  const runBy = new Map(runs.map((r) => [String(r.scenario_id), r]));

  return scenarios.map((s) => {
    const run = runBy.get(String(s.id));
    return {
      id: String(s.id),
      name: s.name,
      description: s.description ?? null,
      simHours: num(s.sim_hours, 24),
      startHour: num(s.start_hour, 0),
      fleet: s.fleet,
      weather: s.weather,
      policy: { ...DEFAULT_POLICY, ...(s.policy as object) },
      baselineRunId: s.baseline_run_id ? String(s.baseline_run_id) : null,
      createdBy: String(s.created_by),
      createdAt: s.created_at.toISOString(),
      runCount: countBy.get(String(s.id)) ?? 0,
      latestRun: run ? toRunDto(run, runMetrics.get(String(run.id)) ?? {}, s.name) : null,
    } satisfies ScenarioDto;
  });
}

export async function getRun(runId: string): Promise<SimulationRunDto> {
  const run = await SimulationRun.findByPk(runId);
  if (!run) throw new AppError('RUN_NOT_FOUND', `No simulation run ${runId}`);

  const scenario = await Scenario.findByPk(run.scenario_id, { paranoid: false });
  const metrics = await metricsFor([String(run.id)]);
  return toRunDto(run, metrics.get(String(run.id)) ?? {}, scenario?.name ?? null);
}

export async function getTimeline(runId: string): Promise<SimulationTimelinePointDto[]> {
  const run = await SimulationRun.findByPk(runId);
  if (!run) throw new AppError('RUN_NOT_FOUND', `No simulation run ${runId}`);

  const rows = await SimulationEvent.findAll({
    where: { run_id: runId },
    order: [['bucket', 'ASC']],
  });

  return rows.map((r) => ({
    bucket: r.bucket,
    simMinutes: r.sim_minutes,
    tripsServed: r.trips_served,
    tripsUnserved: r.trips_unserved,
    meanWaitSeconds: num(r.mean_wait_seconds),
    safetyIncidents: num(r.safety_incidents),
  }));
}

export async function listRuns(scenarioId?: string): Promise<SimulationRunDto[]> {
  const runs = await SimulationRun.findAll({
    where: scenarioId ? { scenario_id: scenarioId } : {},
    order: [['created_at', 'DESC']],
    limit: 100,
  });
  const metrics = await metricsFor(runs.map((r) => String(r.id)));
  const scenarios = await Scenario.findAll({
    where: { id: { [Op.in]: runs.map((r) => String(r.scenario_id)) } },
    paranoid: false,
  });
  const nameBy = new Map(scenarios.map((s) => [String(s.id), s.name]));

  return runs.map((r) =>
    toRunDto(r, metrics.get(String(r.id)) ?? {}, nameBy.get(String(r.scenario_id)) ?? null),
  );
}

// ---- writes -----------------------------------------------------------------

export interface CreateScenarioInput {
  name: string;
  description?: string | null;
  simHours: number;
  startHour: number;
  fleet: { scooter: number; ebike: number; bike: number };
  weather: { precipitationMm: number; tempC: number };
  policy: Partial<typeof DEFAULT_POLICY>;
}

export async function createScenario(
  input: CreateScenarioInput,
  userId: string,
): Promise<ScenarioDto> {
  const scenario = await Scenario.create({
    name: input.name,
    description: input.description ?? null,
    sim_hours: String(input.simHours),
    start_hour: String(input.startHour),
    fleet: input.fleet,
    weather: input.weather,
    policy: { ...DEFAULT_POLICY, ...input.policy },
    created_by: userId,
  });

  return {
    id: String(scenario.id),
    name: scenario.name,
    description: scenario.description ?? null,
    simHours: input.simHours,
    startHour: input.startHour,
    fleet: input.fleet,
    weather: input.weather,
    policy: { ...DEFAULT_POLICY, ...input.policy },
    baselineRunId: null,
    createdBy: String(scenario.created_by),
    createdAt: scenario.created_at.toISOString(),
    runCount: 0,
    latestRun: null,
  };
}

export async function deleteScenario(scenarioId: string): Promise<void> {
  const scenario = await Scenario.findByPk(scenarioId);
  if (!scenario) throw new AppError('SCENARIO_NOT_FOUND', `No scenario ${scenarioId}`);
  // Soft delete: completed runs keep pointing at it, so a three-month-old
  // result can still name the scenario that produced it.
  await scenario.destroy();
}

export async function setBaseline(scenarioId: string, runId: string): Promise<void> {
  const scenario = await Scenario.findByPk(scenarioId);
  if (!scenario) throw new AppError('SCENARIO_NOT_FOUND', `No scenario ${scenarioId}`);

  const run = await SimulationRun.findByPk(runId);
  if (!run || String(run.scenario_id) !== String(scenarioId)) {
    throw new AppError('RUN_NOT_FOUND', `Run ${runId} does not belong to scenario ${scenarioId}`);
  }
  if (run.status !== 'completed') {
    throw new AppError('RUN_NOT_COMPLETED', 'Only a completed run can be a baseline');
  }

  await scenario.update({ baseline_run_id: runId });
}

/**
 * Creates the run row and hands the work to the job runner.
 *
 * Returns immediately with a `queued` run — MODULES.md M06 is explicit that a
 * run is a background job, and design.md §2 traces the path: row in
 * simulation_runs → job runner → worker → progress on the bus → gateway.
 */
export async function queueRun(
  scenarioId: string,
  userId: string,
  seed?: number,
): Promise<SimulationRunDto> {
  const scenario = await Scenario.findByPk(scenarioId);
  if (!scenario) throw new AppError('SCENARIO_NOT_FOUND', `No scenario ${scenarioId}`);

  const run = await SimulationRun.create({
    scenario_id: String(scenario.id),
    // An explicit seed makes a run reproducible on demand; without one a fresh
    // seed explores a different sample of the same scenario.
    seed: seed ?? Math.floor(Math.random() * 2 ** 31),
    status: 'queued',
    created_by: userId,
  });

  const { enqueue } = await import('../../jobs/runner.ts');
  await enqueue('run-simulation', { runId: String(run.id) });

  return toRunDto(run, {}, scenario.name);
}

// ---- the job ----------------------------------------------------------------

interface ZoneRow {
  id: string;
  name: string;
  code: string;
  population_ix: string | null;
  centroid_wkt: string | null;
  congestion: string | null;
}

/**
 * The world the scenario runs against.
 *
 * Congestion comes from the live traffic snapshot averaged per zone, so a
 * simulated result and a measured one are describing the same city — which is
 * exactly the property design.md §1 asks for. Zones with no readings fall back
 * to a mild default rather than to zero: pretending an unmonitored zone is
 * free-flowing would flatter every scenario that touches it.
 */
async function loadZones(): Promise<
  { zoneId: string; name: string; lat: number; lng: number; populationIx: number; congestionIndex: number }[]
> {
  // Reads the stored `centroid` column rather than computing one: MySQL's
  // ST_Centroid is not implemented for geographic spatial reference systems,
  // so on an SRID 4326 polygon it fails outright. The column is seeded
  // alongside the boundary and is what the geo module serves too.
  const rows = await sequelize.query<ZoneRow>(
    `SELECT z.id, z.name, z.code, z.population_ix,
            ${selectGeom('z.centroid', 'centroid_wkt')},
            AVG(ts.congestion_index) AS congestion
       FROM zones z
       LEFT JOIN traffic_snapshots ts ON ts.zone_id = z.id
      GROUP BY z.id, z.name, z.code, z.population_ix, z.centroid
      ORDER BY z.id`,
    { type: QueryTypes.SELECT },
  );

  return rows
    .map((r) => {
      const point = r.centroid_wkt ? parsePoint(r.centroid_wkt) : null;
      if (!point) return null;
      // GeoJSON order: [lng, lat].
      const [lng, lat] = point.coordinates;
      return {
        zoneId: String(r.id),
        name: r.name,
        lng,
        lat,
        populationIx: num(r.population_ix, 5),
        congestionIndex: r.congestion === null ? 0.2 : num(r.congestion, 0.2),
      };
    })
    .filter((z): z is NonNullable<typeof z> => z !== null);
}

const SIM_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Executes one run. Called on a worker thread by the job runner.
 *
 * Reads the ML service's NDJSON stream, forwarding progress to the bus as it
 * arrives and persisting the final result. Everything published from here goes
 * through `publish()` rather than `bus.emit()` — on a worker thread the local
 * bus reaches nobody. See jobs/progress.ts.
 */
export async function executeRun(runId: string): Promise<void> {
  const run = await SimulationRun.findByPk(runId);
  if (!run) throw new Error(`No simulation run ${runId}`);

  const scenario = await Scenario.findByPk(run.scenario_id, { paranoid: false });
  if (!scenario) throw new Error(`Run ${runId} has no scenario`);

  const startedAt = Date.now();
  await run.update({ status: 'running', started_at: new Date(), progress: '0.0000' });

  try {
    if (!env.mlServiceUrl) {
      throw new AppError('SERVICE_UNAVAILABLE', 'The ML service is not configured');
    }

    const zones = await loadZones();
    if (zones.length === 0) {
      throw new AppError('SERVICE_UNAVAILABLE', 'No zones are seeded; cannot simulate a city');
    }

    const spec = {
      seed: run.seed,
      simHours: num(scenario.sim_hours, 24),
      startHour: num(scenario.start_hour, 0),
      zones,
      fleet: scenario.fleet,
      weather: scenario.weather,
      policy: { ...DEFAULT_POLICY, ...(scenario.policy as object) },
      demand: scenario.demand ?? {},
    };

    const res = await fetch(`${env.mlServiceUrl}/internal/sim/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': env.mlInternalSecret },
      body: JSON.stringify({ runId, spec }),
      signal: AbortSignal.timeout(SIM_TIMEOUT_MS),
    });

    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        typeof body.detail === 'string' ? body.detail : `ML service returned ${res.status}`,
      );
    }

    type SimResult = { metrics: Record<string, unknown>; timeline: Record<string, number>[] };
    let result: SimResult | null = null;
    let lastPersisted = 0;

    for await (const message of readNdjson(res.body)) {
      if (message.type === 'error') {
        throw new AppError('SERVICE_UNAVAILABLE', String(message.message));
      }

      if (message.type === 'progress') {
        const pct = num(message.pct);
        publish('run:progress', {
          runId,
          scenarioId: String(run.scenario_id),
          pct,
          simSeconds: num(message.simSeconds),
          tripsServed: num(message.tripsServed),
          tripsUnserved: num(message.tripsUnserved),
        });

        // The socket carries every tick; the DB row is the fallback for a
        // client that polls or reconnects, so it only needs coarse updates.
        // Writing all ~200 ticks would be 200 UPDATEs for a progress bar.
        if (pct - lastPersisted >= 0.05) {
          lastPersisted = pct;
          await run.update({ progress: pct.toFixed(4) });
        }
        continue;
      }

      if (message.type === 'result') {
        result = message as unknown as SimResult;
      }
    }

    if (!result) throw new AppError('SERVICE_UNAVAILABLE', 'Simulation ended without a result');

    await persistResult(runId, result);

    const durationMs = Date.now() - startedAt;
    await run.update({
      status: 'completed',
      progress: '1.0000',
      finished_at: new Date(),
      duration_ms: durationMs,
      detail: extractDetail(result.metrics),
      error: null,
    });

    publish('run:completed', {
      runId,
      scenarioId: String(run.scenario_id),
      status: 'completed',
      durationMs,
      error: null,
    });

    // First completed run becomes the scenario's baseline. Without one, the
    // Results screen has nothing to show a delta against, and a planner
    // comparing their second run to nothing is the common case.
    if (!scenario.baseline_run_id) {
      await scenario.update({ baseline_run_id: runId });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('simulation run failed', { runId, error: message });

    await run.update({
      status: 'failed',
      finished_at: new Date(),
      duration_ms: Date.now() - startedAt,
      error: message.slice(0, 2000),
    });

    publish('run:completed', {
      runId,
      scenarioId: String(run.scenario_id),
      status: 'failed',
      durationMs: Date.now() - startedAt,
      error: message,
    });
  }
}

/** Nested results that do not belong in a scalar key/value table. */
function extractDetail(metrics: Record<string, unknown>): Record<string, unknown> {
  return {
    byKind: metrics.byKind ?? {},
    unservedReasons: metrics.unservedReasons ?? {},
  };
}

async function persistResult(
  runId: string,
  result: { metrics: Record<string, unknown>; timeline: Record<string, number>[] },
): Promise<void> {
  const scalars = Object.entries(result.metrics)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .map(([metric_key, v]) => ({
      run_id: runId,
      metric_key,
      metric_value: String(v as number),
    }));

  // One transaction: a run is either fully readable or not there at all. A
  // half-written metric set would show a planner a chart with missing series
  // and no indication anything was wrong.
  await sequelize.transaction(async (tx) => {
    await SimulationMetric.destroy({ where: { run_id: runId }, transaction: tx });
    await SimulationEvent.destroy({ where: { run_id: runId }, transaction: tx });

    if (scalars.length > 0) {
      await SimulationMetric.bulkCreate(scalars, { transaction: tx });
    }

    if (result.timeline.length > 0) {
      await SimulationEvent.bulkCreate(
        result.timeline.map((t) => ({
          run_id: runId,
          bucket: Number(t.bucket),
          sim_minutes: Number(t.simMinutes),
          trips_served: Number(t.tripsServed),
          trips_unserved: Number(t.tripsUnserved),
          mean_wait_seconds: String(t.meanWaitSeconds),
          safety_incidents: String(t.safetyIncidents),
        })),
        { transaction: tx },
      );
    }
  });
}

/**
 * Parses a newline-delimited JSON stream.
 *
 * Chunk boundaries fall wherever the network puts them, not on newlines, so a
 * naive per-chunk `JSON.parse` breaks the moment a message is split across two
 * reads — intermittently, and only under load. Buffering until a newline is
 * what makes it correct.
 */
async function* readNdjson(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });

    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as Record<string, unknown>;
      newline = buffer.indexOf('\n');
    }
  }

  const tail = buffer.trim();
  if (tail) yield JSON.parse(tail) as Record<string, unknown>;
}

// ---- comparison -------------------------------------------------------------

const LOWER_IS_BETTER = new Set([
  'tripsUnserved',
  'meanWaitSeconds',
  'meanTripSeconds',
  'distanceEmptyKm',
  'emptyRatioPct',
  'safetyIncidents',
  'incidentsPer1000Km',
  'rebalanceDistanceKm',
]);

const COMPARABLE = [
  'tripsServed',
  'tripsUnserved',
  'serviceRatePct',
  'meanWaitSeconds',
  'meanTripSeconds',
  'vehicleUtilizationPct',
  'distanceLoadedKm',
  'distanceEmptyKm',
  'emptyRatioPct',
  'carKmReplaced',
  'co2AvoidedKg',
  'safetyIncidents',
  'incidentsPer1000Km',
];

/**
 * Baseline vs variant.
 *
 * Computed here rather than delegated to the ML service: both runs are already
 * in this database, the arithmetic is subtraction, and a network hop to
 * subtract two numbers would add a failure mode for nothing. The ML service
 * keeps its own `/internal/sim/compare` for callers that hold metrics but no
 * database — the two implementations are pinned to the same expectations by
 * tests on both sides.
 */
export function compareMetrics(
  baseline: SimulationMetrics,
  variant: SimulationMetrics,
): CompareRowDto[] {
  const rows: CompareRowDto[] = [];

  for (const metric of COMPARABLE) {
    if (!(metric in baseline) || !(metric in variant)) continue;

    const b = baseline[metric]!;
    const v = variant[metric]!;
    const delta = v - b;

    let direction: CompareRowDto['direction'];
    if (delta === 0) {
      direction = 'same';
    } else if (LOWER_IS_BETTER.has(metric)) {
      direction = delta < 0 ? 'better' : 'worse';
    } else {
      direction = delta > 0 ? 'better' : 'worse';
    }

    rows.push({
      metric,
      baseline: b,
      variant: v,
      delta: Number(delta.toFixed(3)),
      deltaPct: b === 0 ? null : Number(((delta / b) * 100).toFixed(2)),
      direction,
    });
  }

  return rows;
}

export async function compareRuns(baselineId: string, variantId: string) {
  const [baseline, variant] = await Promise.all([getRun(baselineId), getRun(variantId)]);

  for (const run of [baseline, variant]) {
    if (run.status !== 'completed') {
      throw new AppError('RUN_NOT_COMPLETED', `Run ${run.id} is ${run.status}, not completed`);
    }
  }

  return { baseline, variant, rows: compareMetrics(baseline.metrics, variant.metrics) };
}
