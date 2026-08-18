import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { createAppTheme } from '../src/app/theme.ts';
import { AdminScreen } from '../src/modules/admin/index.ts';
import { useAuthStore } from '../src/lib/auth-store.ts';

const theme = createAppTheme();

const SUMMARY = {
  range: { from: '2026-07-20', to: '2026-08-18', days: 30 },
  totals: {
    trips: 50518,
    distanceKm: 136559.54,
    durationHours: 14634.51,
    energyKwh: 6604.38,
    co2eAvoidedKg: 13388.24,
    tripsPerDay: 1683.9,
  },
  modalSplit: { scooter: 0.25, ev: 0.25, ebike: 0.25, bike: 0.25 },
  zones: [
    { zoneId: '1', name: 'Shahapur', tripsStarted: 7527, tripsEnded: 6274, netFlow: -1253, distanceKm: 20000, co2eAvoidedKg: 1600 },
    { zoneId: '2', name: 'Sadashiv Nagar', tripsStarted: 5393, tripsEnded: 6329, netFlow: 936, distanceKm: 14000, co2eAvoidedKg: 1100 },
  ],
};

const ENVIRONMENT = {
  co2eAvoidedKg: 13388.24,
  energyKwh: 6604.38,
  distanceKm: 136559.54,
  gPerKmSaved: 98.0,
  counterfactual: 'Each trip is assumed to replace a car trip of equal distance.',
  factors: [
    { mode: 'car', gCo2ePerKm: 120, whPerKm: 0, source: 'Indian passenger car fleet average' },
    { mode: 'scooter', gCo2ePerKm: 22, whPerKm: 32, source: 'Shared e-scooter LCA' },
  ],
};

const SERIES = Array.from({ length: 30 }, (_v, i) => ({
  day: `2026-07-${String(20 + (i % 12)).padStart(2, '0')}`,
  trips: 1500 + i * 7,
  distanceKm: 4000,
  activeVehicles: 60,
  tripsPerVehicle: 25,
  meanTripKm: 2.7,
  meanTripMin: 17,
  energyKwh: 200,
  co2eAvoidedKg: 450,
}));

function stubFetch(over: { summary?: unknown; days?: number } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      const json = (data: unknown) =>
        new Response(JSON.stringify({ data }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      if (u.includes('/analytics/summary')) return json(over.summary ?? SUMMARY);
      if (u.includes('/analytics/timeseries')) return json(SERIES);
      if (u.includes('/analytics/environment')) return json(ENVIRONMENT);
      return json(null);
    }),
  );
}

beforeEach(() => {
  useAuthStore.getState().setSession('t', {
    id: '1',
    email: 'admin@belagavi.local',
    fullName: 'Asha Nayak',
    phone: null,
    status: 'active',
    roles: ['admin'],
    operatorId: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
  });
  stubFetch();
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

describe('AdminScreen', () => {
  it('shows the headline KPI totals', async () => {
    wrap(<AdminScreen />);
    expect(await screen.findByText('City analytics')).toBeDefined();
    expect(screen.getByText('Trips')).toBeDefined();
    expect(screen.getByText('50,518')).toBeDefined();
    expect(screen.getByText('CO₂ avoided')).toBeDefined();
  });

  it('says the numbers come from rollups, not live aggregation', async () => {
    wrap(<AdminScreen />);
    // CLAUDE.md forbids aggregating raw data at request time; the screen states
    // where its numbers come from so a reviewer can check the claim.
    expect(await screen.findByText(/read from nightly rollups/)).toBeDefined();
  });

  it('shows net flow per zone — where vehicles accumulate', async () => {
    wrap(<AdminScreen />);
    expect(await screen.findByText('Where vehicles accumulate')).toBeDefined();
    expect(screen.getByText(/persistently positive fills up/)).toBeDefined();
    expect(screen.getAllByText('Shahapur').length).toBeGreaterThan(0);
  });

  it('states the emissions counterfactual rather than a bare number', async () => {
    wrap(<AdminScreen />);
    expect(
      await screen.findByText(/assumed to replace a car trip/),
    ).toBeDefined();
  });

  it('shows the modal split as percentages', async () => {
    wrap(<AdminScreen />);
    expect(await screen.findByText('Modal split')).toBeDefined();
    expect(screen.getAllByText('25.0%').length).toBe(4);
  });

  it('offers a CSV export', async () => {
    wrap(<AdminScreen />);
    expect(await screen.findByText('Export CSV')).toBeDefined();
  });

  it('tells you how to fix an empty dashboard instead of showing zeros', async () => {
    stubFetch({
      summary: {
        ...SUMMARY,
        range: { from: '2026-07-20', to: '2026-08-18', days: 0 },
        totals: { trips: 0, distanceKm: 0, durationHours: 0, energyKwh: 0, co2eAvoidedKg: 0, tripsPerDay: 0 },
        zones: [],
      },
    });

    wrap(<AdminScreen />);
    expect(await screen.findByText('No rollups yet')).toBeDefined();
    expect(screen.getByText(/npm run rollup/)).toBeDefined();
  });
});
