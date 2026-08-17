import { QueryTypes } from 'sequelize';
import type { Sequelize, Transaction } from 'sequelize';

/**
 * M06 demo scenarios.
 *
 * Four scenarios that form an argument rather than a list. The baseline is the
 * city as it runs today; each of the other three pulls exactly one lever, so
 * any difference in the results is attributable to that lever and nothing else.
 * A planner comparing "Protected bike lanes" against "Baseline" is reading a
 * controlled experiment, which is the entire point of the module.
 *
 * Fleet sizes are deliberately below saturation. An oversupplied city serves
 * 100% of demand under every policy, every lever reads as "no change", and the
 * screen teaches a planner nothing.
 */

interface ScenarioSeed {
  name: string;
  description: string;
  simHours: number;
  startHour: number;
  fleet: { scooter: number; ebike: number; bike: number };
  weather: { precipitationMm: number; tempC: number };
  policy: Record<string, unknown>;
  /** Resolved to the four densest zone ids at seed time. */
  bikeLanesInCentre?: boolean;
}

const BASE_FLEET = { scooter: 90, ebike: 45, bike: 30 };
const DRY = { precipitationMm: 0, tempC: 28 };

const SCENARIOS: ScenarioSeed[] = [
  {
    name: 'Baseline — typical weekday',
    description:
      'The city as it runs today: current fleet, dry weather, no interventions. ' +
      'Every other scenario is read against this one.',
    simHours: 24,
    startHour: 0,
    fleet: BASE_FLEET,
    weather: DRY,
    policy: {},
  },
  {
    name: 'Protected bike lanes — city centre',
    description:
      'Segregated infrastructure across the four central zones. Tests the safety ' +
      'case: does protected infrastructure cut the incident rate enough to justify it?',
    simHours: 24,
    startHour: 0,
    fleet: BASE_FLEET,
    weather: DRY,
    policy: {},
    bikeLanesInCentre: true,
  },
  {
    name: 'Overnight rebalancing',
    description:
      'Vans redistribute idle vehicles every 45 minutes. Tests whether moving ' +
      'existing stock beats buying more of it — and what the empty kilometres cost.',
    simHours: 24,
    startHour: 0,
    fleet: BASE_FLEET,
    weather: DRY,
    policy: { rebalanceEnabled: true, rebalanceIntervalMin: 45, rebalanceVanCapacity: 10 },
  },
  {
    name: 'Monsoon day',
    description:
      'Heavy rain across the city. Tests fleet planning against the weather that ' +
      'actually suppresses ridership in Belagavi for weeks at a time.',
    simHours: 24,
    startHour: 0,
    fleet: BASE_FLEET,
    weather: { precipitationMm: 12, tempC: 23 },
    policy: {},
  },
];

const DEFAULT_POLICY = {
  bikeLaneZones: [] as string[],
  closedZones: [] as string[],
  demandMultiplier: 1,
  rebalanceEnabled: false,
  rebalanceIntervalMin: 60,
  rebalanceVanCapacity: 8,
};

export async function seedScenarios(s: Sequelize, t: Transaction): Promise<number> {
  const existing = await s.query<{ n: number }>('SELECT COUNT(*) AS n FROM scenarios', {
    type: QueryTypes.SELECT,
    plain: true,
    transaction: t,
  });
  // Idempotent: a planner's own scenarios must survive a re-seed.
  if ((existing?.n ?? 0) > 0) return 0;

  const planner = await s.query<{ id: string }>(
    `SELECT id FROM users WHERE email = 'planner@belagavi.local' LIMIT 1`,
    { type: QueryTypes.SELECT, plain: true, transaction: t },
  );
  if (!planner) return 0;

  // The densest zones, which is where infrastructure spending is argued about.
  const central = await s.query<{ id: string }>(
    'SELECT id FROM zones ORDER BY population_ix DESC LIMIT 4',
    { type: QueryTypes.SELECT, transaction: t },
  );
  const centralIds = central.map((z) => String(z.id));

  for (const scenario of SCENARIOS) {
    const policy = {
      ...DEFAULT_POLICY,
      ...scenario.policy,
      ...(scenario.bikeLanesInCentre ? { bikeLaneZones: centralIds } : {}),
    };

    await s.query(
      `INSERT INTO scenarios
         (name, description, sim_hours, start_hour, fleet, weather, policy, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      {
        replacements: [
          scenario.name,
          scenario.description,
          scenario.simHours,
          scenario.startHour,
          JSON.stringify(scenario.fleet),
          JSON.stringify(scenario.weather),
          JSON.stringify(policy),
          planner.id,
        ],
        transaction: t,
      },
    );
  }

  return SCENARIOS.length;
}
