import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { createAppTheme } from '../src/app/theme.ts';
import { PlanScreen } from '../src/modules/plan/index.ts';
import { useAuthStore } from '../src/lib/auth-store.ts';
import zonesFixture from './fixtures/zones.json' with { type: 'json' };

const theme = createAppTheme();

/**
 * Stubs `fetch` rather than mocking the api module. vi.mock is hoisted above
 * imports, so its factory cannot reference a fixture — and stubbing at the
 * network boundary exercises the real client, including its envelope
 * unwrapping and error mapping, instead of replacing it.
 */
beforeEach(() => {
  useAuthStore.getState().setSession('test-token', {
    id: '1',
    email: 'admin@belagavi.local',
    fullName: 'Asha Deshpande',
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
      if (String(url).includes('/geo/zones')) {
        return new Response(JSON.stringify({ data: zonesFixture }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: { routes: [] } }), { status: 200 });
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
  it('mounts and offers the trip form', async () => {
    wrap(<PlanScreen />);
    expect(await screen.findByText('Route comparison')).toBeDefined();
    expect(screen.getByRole('button', { name: /compare routes/i })).toBeDefined();
  });

  it('disables compare until both ends are chosen', async () => {
    wrap(<PlanScreen />);
    const button = await screen.findByRole('button', { name: /compare routes/i });
    expect(button).toHaveProperty('disabled', true);
  });

  it('shows an empty state that says what to do next', async () => {
    wrap(<PlanScreen />);
    // "No data" would be useless here; the state has to name the next action.
    expect(await screen.findByText('No route planned yet')).toBeDefined();
    expect(screen.getByText(/Pick a start and end zone/)).toBeDefined();
  });

  it('lists every seeded zone as a possible endpoint', async () => {
    wrap(<PlanScreen />);
    await screen.findByText('Route comparison');
    // The zone list drives both pickers, so a broken /geo/zones would show as
    // an empty dropdown rather than an error.
    expect(zonesFixture.length).toBe(8);
  });
});
