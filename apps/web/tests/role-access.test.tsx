import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import type { FleetSummaryDto, Role, VehicleDto } from '@mm/shared-types';
import { createAppTheme } from '../src/app/theme.ts';
import { RequireAuth } from '../src/app/guard.tsx';
import { AppShell } from '../src/components/AppShell.tsx';
import { FleetScreen } from '../src/modules/fleet/index.ts';
import { ACCESS, canOpen, homeFor } from '../src/lib/access.ts';
import { useAuthStore } from '../src/lib/auth-store.ts';

const theme = createAppTheme();

const SUMMARY: FleetSummaryDto = {
  total: 60,
  byStatus: { available: 30, reserved: 2, in_use: 12, returning: 1, charging: 5, maintenance: 10, retired: 0 },
  activeRentals: 1,
};

const RENTED: VehicleDto = {
  id: '7',
  operatorId: '1',
  operatorName: 'Belagavi Mobility Co-op',
  homeZoneId: '1',
  homeZoneName: 'Camp',
  externalRef: 'BGM-MOBI-0007',
  unlockCode: 'K7MX2QPA',
  stationId: null,
  stationName: null,
  activeRental: { riderName: 'Vikram Naik', startedAt: new Date(Date.now() - 300_000).toISOString(), distanceM: 1250 },
  type: 'scooter',
  status: 'in_use',
  batteryPct: 64,
  lastSeenAt: new Date().toISOString(),
  lastPosition: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function signInAs(...roles: Role[]) {
  useAuthStore.getState().setSession('t', {
    id: '1',
    email: 'someone@belagavi.local',
    fullName: 'Someone',
    phone: null,
    status: 'active',
    roles,
    operatorId: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
  });
}

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={qc}>
        <MemoryRouter>{node}</MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = String(url);
      const data = u.includes('/vehicles/summary') ? SUMMARY : u.includes('/vehicles') ? [RENTED] : [];
      return new Response(JSON.stringify({ data, meta: { total: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

describe('which screens a role can open', () => {
  const screens = ['/live', '/plan', '/ride', '/trips', '/sim', '/fleet', '/data', '/admin'];
  const open = (role: Role) => screens.filter((p) => canOpen([role], p));

  it('gives each role its own set', () => {
    expect(open('admin')).toEqual(screens);
    expect(open('commuter')).toEqual(['/live', '/plan', '/ride', '/trips']);
    expect(open('operator')).toEqual(['/live', '/plan', '/fleet']);
    expect(open('planner')).toEqual(['/live', '/plan', '/sim', '/fleet', '/data', '/admin']);
    expect(open('analyst')).toEqual(['/live', '/plan', '/sim', '/fleet', '/data', '/admin']);
  });

  it('sends each role to its own dashboard after sign-in', () => {
    expect(homeFor(['admin'])).toBe('/admin');
    expect(homeFor(['operator'])).toBe('/fleet');
    expect(homeFor(['planner'])).toBe('/sim');
    expect(homeFor(['analyst'])).toBe('/data');
    expect(homeFor(['commuter'])).toBe('/ride');
  });

  it('gives someone with several roles the most senior one’s dashboard', () => {
    expect(homeFor(['commuter', 'admin'])).toBe('/admin');
    expect(homeFor(['analyst', 'operator'])).toBe('/fleet');
  });

  it('never sends a role to a dashboard it cannot open', () => {
    for (const role of ['admin', 'planner', 'operator', 'analyst', 'commuter'] as Role[]) {
      expect(canOpen([role], homeFor([role]))).toBe(true);
    }
  });
});

describe('the icon rail', () => {
  it('shows a rider only the rider screens', () => {
    signInAs('commuter');
    wrap(
      <AppShell>
        <div />
      </AppShell>,
    );
    for (const label of ['Live', 'Plan', 'Ride', 'Trips']) expect(screen.getByText(label)).toBeDefined();
    for (const label of ['Sim', 'Fleet', 'Data', 'Admin']) expect(screen.queryByText(label)).toBeNull();
  });

  it('shows an admin everything', () => {
    signInAs('admin');
    wrap(
      <AppShell>
        <div />
      </AppShell>,
    );
    for (const label of ['Live', 'Plan', 'Ride', 'Trips', 'Sim', 'Fleet', 'Data', 'Admin']) {
      expect(screen.getByText(label)).toBeDefined();
    }
  });
});

describe('opening a screen by its address', () => {
  it('stops a rider at the door of the Fleet screen and offers a way back', () => {
    signInAs('commuter');
    wrap(
      <RequireAuth roles={ACCESS.fleetRead}>
        <div>fleet contents</div>
      </RequireAuth>,
    );
    expect(screen.getByText('You do not have access to this area')).toBeDefined();
    expect(screen.queryByText('fleet contents')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to my home screen' }).getAttribute('href')).toBe('/ride');
  });
});

describe('the Fleet screen', () => {
  it('shows the live counts and who is riding', async () => {
    signInAs('admin');
    wrap(<FleetScreen />);
    expect(await screen.findByText('Maintenance')).toBeDefined();
    expect(await screen.findByText('12')).toBeDefined();
    expect(screen.getByText('1 on rentals now')).toBeDefined();
    expect(await screen.findByText('Vikram Naik')).toBeDefined();
  });

  it('gives an analyst no unlock codes to see', async () => {
    signInAs('analyst');
    wrap(<FleetScreen />);
    await screen.findByText('BGM-MOBI-0007');
    expect(screen.queryByText('QR')).toBeNull();
    expect(screen.queryByText('K7MX2QPA')).toBeNull();
  });
});
