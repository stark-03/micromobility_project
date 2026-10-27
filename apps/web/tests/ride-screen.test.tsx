import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CssBaseline, ThemeProvider } from '@mui/material';
import type { EcoSummaryDto, RentalDto } from '@mm/shared-types';
import { createAppTheme } from '../src/app/theme.ts';
import { RideScreen } from '../src/modules/ride/index.ts';
import { TripsScreen } from '../src/modules/trips/index.ts';
import { densify } from '../src/modules/ride/gps.ts';
import { parseUnlockCode } from '../src/components/VehicleQr.tsx';
import { useAuthStore } from '../src/lib/auth-store.ts';

const theme = createAppTheme();

const RENTAL: RentalDto = {
  id: '42',
  publicRef: 'c0ffee00-0000-4000-8000-000000000042',
  status: 'active',
  vehicle: {
    id: '7',
    externalRef: 'BGM-MOBI-0007',
    unlockCode: 'K7MX2QPA',
    type: 'scooter',
    battery: { pct: 64, capacityWh: 470, rangeM: 16000 },
  },
  startStation: { id: '1', name: 'Fort Road' },
  endStation: null,
  startedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  endedAt: null,
  startPosition: [74.4968, 15.8517],
  endPosition: null,
  distanceM: 1250,
  durationS: 300,
  plan: {
    id: '2',
    vehicleType: 'scooter',
    name: 'E-scooter — pay as you go',
    currency: 'INR',
    unlockFeeMinor: 1000,
    perMinuteMinor: 200,
    minimumFareMinor: 2000,
  },
  fare: {
    currency: 'INR',
    unlockFeeMinor: 1000,
    timeFeeMinor: 1000,
    minutes: 5,
    minimumTopUpMinor: 0,
    totalMinor: 2000,
  },
  energyWh: null,
  co2SavedG: null,
  path: [
    [74.4968, 15.8517],
    [74.5003, 15.854],
  ],
  payment: null,
};

let activeRental: RentalDto | null = null;
let history: RentalDto[] = [];

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
  activeRental = null;
  history = [];

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
      if (u.includes('/rentals/active')) return json(activeRental);
      if (u.includes('/rentals/preview')) {
        return json({
          vehicle: {
            id: '7',
            externalRef: 'BGM-MOBI-0007',
            unlockCode: 'K7MX2QPA',
            type: 'scooter',
            status: 'available',
            battery: { pct: 88, capacityWh: 470, rangeM: 22000 },
            rentable: true,
          },
          stationName: 'Fort Road',
          plan: RENTAL.plan,
          notRentableReason: null,
        });
      }
      if (u.includes('/rentals/eco-summary')) {
        const eco: EcoSummaryDto = {
          trips: history.length,
          distanceKm: 3.4,
          rideMinutes: 14,
          spentMinor: 3400,
          currency: 'INR',
          energyKwh: 0.11,
          co2SavedKg: 0.33,
          byType: [{ type: 'scooter', trips: history.length, distanceKm: 3.4, co2SavedKg: 0.33 }],
          counterfactual: 'Each ride is assumed to replace a car trip of the same distance.',
        };
        return json(eco);
      }
      if (u.includes('/rentals?')) return json(history);
      return json([]);
    }),
  );
});

function wrap(node: React.ReactNode, path = '/ride') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('RideScreen', () => {
  it('offers to find a vehicle and to scan one when not riding', async () => {
    wrap(<RideScreen />);
    expect(await screen.findByText('Rent a vehicle')).toBeDefined();
    expect(screen.getByText('Scan QR to unlock')).toBeDefined();
    // Choosing a location by name, not only by map click.
    expect(screen.getByLabelText('Where are you?')).toBeDefined();
    expect(screen.getByText('Find a vehicle near you')).toBeDefined();
  });

  it('shows live journey monitoring while a ride is active', async () => {
    activeRental = RENTAL;
    wrap(<RideScreen />);
    expect(await screen.findByText('Ride in progress')).toBeDefined();
    expect(screen.getByText('1.25 km')).toBeDefined();
    expect(screen.getByText(/64% · 16\.00 km/)).toBeDefined();
    expect(screen.getByText('₹20')).toBeDefined();
    expect(screen.getByText("Share my phone's GPS")).toBeDefined();
    expect(screen.getByText('End ride here')).toBeDefined();
  });

  it('opens the unlock dialog straight from a scanned sticker link, with the tariff', async () => {
    wrap(<RideScreen />, '/ride?unlock=K7MX2QPA');
    expect(await screen.findByText('Scan to unlock')).toBeDefined();
    // Cost is shown before the journey begins.
    expect(await screen.findByText(/₹10 to unlock \+ ₹2\/min/)).toBeDefined();
    expect(screen.getByText('Unlock and ride')).toBeDefined();
  });
});

describe('TripsScreen', () => {
  it('tells a new rider how to take their first trip', async () => {
    wrap(<TripsScreen />, '/trips');
    expect(await screen.findByText('No journeys yet')).toBeDefined();
    expect(screen.getByText('Find a vehicle')).toBeDefined();
  });

  it('lists past journeys with their fare and payment, under an eco summary', async () => {
    history = [
      {
        ...RENTAL,
        status: 'completed',
        endStation: { id: '3', name: 'Camp Market' },
        endedAt: new Date().toISOString(),
        payment: {
          id: '1',
          amountMinor: 2000,
          currency: 'INR',
          provider: 'mock',
          providerRef: 'mock_pay_x',
          status: 'succeeded',
          createdAt: new Date().toISOString(),
        },
      },
    ];
    wrap(<TripsScreen />, '/trips');
    expect(await screen.findByText('Fort Road → Camp Market')).toBeDefined();
    expect(screen.getByText('Paid')).toBeDefined();
    expect(await screen.findByText('Your eco-travel summary')).toBeDefined();
    expect(screen.getByText('0.3 kg')).toBeDefined();
  });
});

describe('parseUnlockCode', () => {
  it('reads the code out of a sticker link', () => {
    expect(parseUnlockCode('https://example.org/ride?unlock=k7mx2qpa')).toBe('K7MX2QPA');
  });

  it('accepts a typed code with spaces or a dash', () => {
    expect(parseUnlockCode(' k7mx-2qpa ')).toBe('K7MX2QPA');
  });

  it('rejects anything that is not eight letters and digits', () => {
    expect(parseUnlockCode('hello')).toBeNull();
    expect(parseUnlockCode('https://example.org/ride')).toBeNull();
  });
});

describe('densify', () => {
  it('spaces simulated fixes evenly and ends exactly at the destination', () => {
    const path: [number, number][] = [
      [74.5, 15.85],
      [74.51, 15.85],
    ]; // ~1.07 km due east
    const pts = densify(path, 100);
    expect(pts[0]).toEqual(path[0]);
    expect(pts[pts.length - 1]).toEqual(path[1]);
    expect(pts.length).toBeGreaterThanOrEqual(11);
    expect(pts.length).toBeLessThanOrEqual(13);
  });
});
