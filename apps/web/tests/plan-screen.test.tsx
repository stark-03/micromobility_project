import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { createAppTheme } from '../src/app/theme.ts';
import { PlanScreen } from '../src/modules/plan/index.ts';
import { RiskBreakdown, RiskChip } from '../src/modules/plan/RiskSummary.tsx';
import { useAuthStore } from '../src/lib/auth-store.ts';
import type { RouteRiskDto } from '@mm/shared-types';
import zonesFixture from './fixtures/zones.json' with { type: 'json' };

const theme = createAppTheme();

const risk: RouteRiskDto = {
  score: 47.5,
  level: 'medium',
  factors: { accidents: 62, roadQuality: 40, traffic: 30, lighting: 20, infrastructure: 70 },
  incidentCount: 3,
  unsurveyedPct: 12,
};

/**
 * Leaflet needs a 2D canvas context, which jsdom does not implement. Stubbing
 * it lets the map mount so the screen around it can be asserted; the map's own
 * rendering is not what these tests are about.
 */
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;

  useAuthStore.getState().setSession('t', {
    id: '1',
    email: 'rider@belagavi.local',
    fullName: 'Asha Rider',
    phone: null,
    status: 'active',
    roles: ['commuter'],
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
      if (u.includes('/geo/zones')) return json(zonesFixture);
      if (u.includes('/charging/vehicles/near')) return json([]);
      if (u.includes('/charging/stations/along-route')) return json([]);
      if (u.includes('/charging/stations/near')) return json([]);
      return json({ routes: [] });
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

describe('PlanScreen', () => {
  it('renders a map, which is how a rider sets where they are', async () => {
    const { container } = wrap(<PlanScreen />);
    // The screen used to be two dropdowns of zone names, which is why nobody
    // could locate themselves. The map IS the feature.
    expect(container.querySelector('[data-testid="route-map"]')).not.toBeNull();
  });

  it('asks for a pickup and a destination', async () => {
    wrap(<PlanScreen />);
    expect(await screen.findByText('Pickup')).toBeDefined();
    expect(screen.getByText('Destination')).toBeDefined();
  });

  it('says both pins are unset before anything is clicked', async () => {
    wrap(<PlanScreen />);
    const prompts = await screen.findAllByText(/not set — click the map/);
    expect(prompts).toHaveLength(2);
  });

  it('offers a way in for someone who will not grant location access', async () => {
    wrap(<PlanScreen />);
    // Geolocation is refused on insecure origins and by users who decline, so
    // clicking the map and a sample trip both have to work without it.
    expect(await screen.findByText('Use my location')).toBeDefined();
    expect(screen.getByText('Sample trip')).toBeDefined();
  });

  it('tells you what to do before any pin exists', async () => {
    wrap(<PlanScreen />);
    expect(await screen.findByText('Pick two points')).toBeDefined();
    expect(
      screen.getByText(/Click the map for your pickup, then your destination/),
    ).toBeDefined();
  });

  it('lets a rider choose the vehicle they are planning for', async () => {
    wrap(<PlanScreen />);
    expect(await screen.findByLabelText('Vehicle')).toBeDefined();
  });

  it('lets a rider choose places by name instead of on the map', async () => {
    wrap(<PlanScreen />);
    expect(await screen.findByLabelText('From — search a place')).toBeDefined();
    expect(screen.getByLabelText('To — search a place')).toBeDefined();
  });
});

describe('route risk', () => {
  it('names the band in words, not colour alone', () => {
    wrap(<RiskChip risk={risk} />);
    expect(screen.getByText('Medium risk')).toBeDefined();
  });

  it('explains the score with all five factors and the incident count', () => {
    wrap(<RiskBreakdown risk={risk} />);
    expect(screen.getByText('Why this route is medium risk')).toBeDefined();
    for (const label of ['Accident history', 'Traffic', 'Cycling infrastructure', 'Street lighting', 'Road quality']) {
      expect(screen.getByText(label)).toBeDefined();
    }
    expect(screen.getByText(/3 recorded incidents on this route/)).toBeDefined();
    expect(screen.getByText(/12% of it has no road-surface survey/)).toBeDefined();
  });
});
