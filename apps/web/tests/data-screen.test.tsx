import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { createAppTheme } from '../src/app/theme.ts';
import { DataScreen } from '../src/modules/data/index.ts';
import { seriesColours, token } from '../src/lib/tokens.ts';
import { useAuthStore } from '../src/lib/auth-store.ts';
import zonesFixture from './fixtures/zones.json' with { type: 'json' };

const theme = createAppTheme();

const MODELS = [
  {
    id: '2',
    version: 'demand-20260812-235937',
    algorithm: 'lightgbm',
    train_rows: 20912,
    valid_rows: 5376,
    mae: '0.2387',
    rmse: '0.4101',
    mape: '10.7812',
    baseline_mae: '0.6012',
    skill_ratio: '0.3971',
    is_active: 1,
    created_at: new Date().toISOString(),
  },
  {
    id: '1',
    version: 'demand-20260812-235706',
    algorithm: 'lightgbm',
    train_rows: 20912,
    valid_rows: 5376,
    mae: '0.5922',
    rmse: '0.8646',
    mape: '26.94',
    baseline_mae: '0.752',
    skill_ratio: '0.7874',
    is_active: 0,
    created_at: new Date().toISOString(),
  },
];

beforeEach(() => {
  useAuthStore.getState().setSession('t', {
    id: '1',
    email: 'a@b.local',
    fullName: 'Asha',
    phone: null,
    status: 'active',
    roles: ['admin'],
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
      if (u.includes('/predictions/models')) return json(MODELS);
      if (u.includes('/predictions/demand')) return json([]);
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

describe('chart tokens', () => {
  it('uses a chart scale separate from the mode and flow colours', () => {
    const [a, b] = seriesColours();
    // The --line-* accents sit outside the chart lightness band and --flow-* is
    // reserved for congestion; reusing either would break both rules at once.
    expect(a).not.toBe(token('--line-ev'));
    expect(b).not.toBe(token('--line-scooter'));
    expect([a, b]).not.toContain(token('--flow-2'));
  });

  it('is the validated pair', () => {
    // CVD separation dE 29.3 protan, normal-vision 30.3, contrast >= 3:1, both
    // inside OKLCH L 0.48-0.67. Changing these requires re-running the validator.
    expect(seriesColours()).toEqual(['#4D8DF7', '#BE8317']);
  });
});

describe('DataScreen', () => {
  it('shows the active model and its accuracy beside it', async () => {
    wrap(<DataScreen />);
    // design.md §1: a forecast never ships as a bare number.
    expect(await screen.findByText('Demand forecasting')).toBeDefined();
    // The MAE appears in the headline tile AND in its registry row — both are
    // correct, so assert presence rather than uniqueness.
    expect(screen.getAllByText('0.239').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('baseline 0.601')).toBeDefined();
    expect(screen.getAllByText('0.397').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('target ≤ 0.70')).toBeDefined();
  });

  it('lists every fit in the registry, active and not', async () => {
    wrap(<DataScreen />);
    await screen.findByText('Model registry');
    expect(screen.getByText('Active')).toBeDefined();
    // The rejected 0.787 fit is still recorded — that is the governance story.
    expect(screen.getByText('Inactive')).toBeDefined();
    expect(screen.getByText('0.787')).toBeDefined();
  });

  it('labels model state in words, never colour alone', async () => {
    wrap(<DataScreen />);
    await screen.findByText('Model registry');
    // A colour-only status chip is unreadable to a CVD user and in print.
    expect(screen.getByText('Active').textContent).toBe('Active');
  });

  it('tells the user what to do when there is no forecast', async () => {
    wrap(<DataScreen />);
    expect(await screen.findByText('No forecast yet')).toBeDefined();
    expect(screen.getByText(/Train the model first/)).toBeDefined();
  });
});
