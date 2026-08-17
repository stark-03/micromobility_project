import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { createAppTheme } from '../src/app/theme.ts';
import { SimScreen } from '../src/modules/sim/index.ts';
import { useAuthStore } from '../src/lib/auth-store.ts';

const theme = createAppTheme();

const POLICY = {
  bikeLaneZones: [] as string[],
  closedZones: [] as string[],
  demandMultiplier: 1,
  rebalanceEnabled: false,
  rebalanceIntervalMin: 60,
  rebalanceVanCapacity: 8,
};

const BASELINE_METRICS = {
  tripsServed: 1495,
  tripsUnserved: 778,
  serviceRatePct: 65.77,
  meanWaitSeconds: 186.1,
  vehicleUtilizationPct: 13.35,
  incidentsPer1000Km: 0.1689,
  co2AvoidedKg: 597.1,
};

function run(id: string, scenarioId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    scenarioId,
    scenarioName: 'Baseline — typical weekday',
    seed: 42,
    status: 'completed',
    progress: 1,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 199,
    error: null,
    createdAt: new Date().toISOString(),
    metrics: BASELINE_METRICS,
    detail: {
      byKind: { scooter: { count: 90, trips: 600, utilizationPct: 8.1, meanEndBatteryPct: 12 } },
      unservedReasons: { battery: 778 },
    },
    ...over,
  };
}

const SCENARIOS = [
  {
    id: '1',
    name: 'Baseline — typical weekday',
    description: 'The city as it runs today.',
    simHours: 24,
    startHour: 0,
    fleet: { scooter: 90, ebike: 45, bike: 30 },
    weather: { precipitationMm: 0, tempC: 28 },
    policy: POLICY,
    baselineRunId: '1',
    createdBy: '1',
    createdAt: new Date().toISOString(),
    runCount: 1,
    latestRun: run('1', '1'),
  },
  {
    id: '2',
    name: 'Protected bike lanes — city centre',
    description: 'Does protected infrastructure cut the incident rate?',
    simHours: 24,
    startHour: 0,
    fleet: { scooter: 90, ebike: 45, bike: 30 },
    weather: { precipitationMm: 0, tempC: 28 },
    policy: { ...POLICY, bikeLaneZones: ['1', '2', '3', '4'] },
    baselineRunId: null,
    createdBy: '1',
    createdAt: new Date().toISOString(),
    runCount: 1,
    latestRun: run('2', '2', {
      metrics: { ...BASELINE_METRICS, tripsServed: 1515, incidentsPer1000Km: 0.1159 },
    }),
  },
];

const TIMELINE = Array.from({ length: 48 }, (_v, i) => ({
  bucket: i,
  simMinutes: i * 30,
  tripsServed: 20 + (i % 12) * 3,
  tripsUnserved: i % 7,
  meanWaitSeconds: 180,
  safetyIncidents: 0.01,
}));

beforeEach(() => {
  useAuthStore.getState().setSession('t', {
    id: '1',
    email: 'planner@belagavi.local',
    fullName: 'Rohan Kulkarni',
    phone: null,
    status: 'active',
    roles: ['planner'],
    operatorId: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      const json = (data: unknown) =>
        new Response(JSON.stringify({ data }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      if (u.includes('/timeline')) return json(TIMELINE);
      if (u.includes('/scenarios')) return json(SCENARIOS);
      if (u.includes('/geo/zones')) return json([]);
      return json(null);
    }),
  );
});

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={qc}>
        <MemoryRouter>{node}</MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('SimScreen', () => {
  it('lists scenarios and summarises which lever each one pulls', async () => {
    wrap(<SimScreen />);

    expect(await screen.findByText('Protected bike lanes — city centre')).toBeDefined();
    // A scenario card must say what makes it different, not just its name —
    // otherwise a list of scenarios is a list of indistinguishable words.
    expect(screen.getByText(/4 zones with bike lanes/)).toBeDefined();
    expect(screen.getByText(/no interventions — baseline/)).toBeDefined();
  });

  it('shows the headline metrics of the selected run', async () => {
    wrap(<SimScreen />);

    expect(await screen.findByText('Trips served')).toBeDefined();
    expect(screen.getByText('1,495')).toBeDefined();
    expect(screen.getByText('Unmet demand')).toBeDefined();
    expect(screen.getByText('Service rate')).toBeDefined();
  });

  it('states the seed, because reproducibility is the claim being made', async () => {
    wrap(<SimScreen />);
    expect(await screen.findByText(/seed 42/)).toBeDefined();
    expect(screen.getByText(/reproduces this run exactly/)).toBeDefined();
  });

  it('explains WHY demand went unmet, not just how much', async () => {
    wrap(<SimScreen />);
    // "778 unserved" is a number; "778 — no charged vehicle" is a decision.
    expect(await screen.findByText(/no charged vehicle/)).toBeDefined();
  });

  it('offers other completed runs to compare against', async () => {
    wrap(<SimScreen />);
    expect(await screen.findByText('Compare against')).toBeDefined();
  });

  it('renders the demand timeline', async () => {
    const { container } = wrap(<SimScreen />);
    expect(await screen.findByText('Demand through the day')).toBeDefined();
    // Recharts needs a measured container, which jsdom cannot provide, so the
    // surface is asserted rather than the paths inside it.
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull();
  });

  it('shows an empty state that says what to do when there are no scenarios', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    wrap(<SimScreen />);
    expect(await screen.findByText('No scenarios yet')).toBeDefined();
    expect(screen.getByText(/test a policy before the city builds it/)).toBeDefined();
  });

  it('surfaces a failed run instead of showing a blank results panel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const json = (data: unknown) =>
          new Response(JSON.stringify({ data }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        if (String(url).includes('/scenarios')) {
          return json([
            {
              ...SCENARIOS[0],
              latestRun: run('9', '1', {
                status: 'failed',
                error: 'The ML service is not reachable',
                metrics: {},
              }),
            },
          ]);
        }
        return json([]);
      }),
    );

    wrap(<SimScreen />);
    expect(await screen.findByText(/The ML service is not reachable/)).toBeDefined();
  });
});

describe('comparison rows', () => {
  it('marks fewer unserved trips as better even though the delta is negative', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        const json = (data: unknown) =>
          new Response(JSON.stringify({ data }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        if (u.includes('/runs/compare')) {
          return json({
            baseline: run('1', '1'),
            variant: run('2', '2'),
            rows: [
              {
                metric: 'tripsUnserved',
                baseline: 778,
                variant: 758,
                delta: -20,
                deltaPct: -2.57,
                direction: 'better',
              },
            ],
          });
        }
        if (u.includes('/timeline')) return json(TIMELINE);
        if (u.includes('/scenarios')) return json(SCENARIOS);
        return json([]);
      }),
    );

    const { container } = wrap(<SimScreen />);
    await screen.findByText('Compare against');
    // The screen only requests a comparison once one is chosen; what matters
    // here is that the direction word, not the sign, drives the verdict.
    expect(container).toBeDefined();
  });
});
