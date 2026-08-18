import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { AppShell } from '../components/AppShell.tsx';
import { LoadingState } from '../components/StateViews.tsx';
import { SignInScreen } from '../modules/auth/index.ts';
import { RequireAuth } from './guard.tsx';

/**
 * Fleet is lazy so MUI's DataGrid lands in its own chunk rather than in the
 * initial bundle. design.md §8 sets the initial JS budget at 250 KB gzipped
 * with heavy views loaded on demand; the sign-in screen is what actually loads
 * first, and it needs none of the grid.
 */
const FleetScreen = lazy(() =>
  import('../modules/fleet/index.ts').then((m) => ({ default: m.FleetScreen })),
);

const DataScreen = lazy(() =>
  import('../modules/data/index.ts').then((m) => ({ default: m.DataScreen })),
);

const PlanScreen = lazy(() =>
  import('../modules/plan/index.ts').then((m) => ({ default: m.PlanScreen })),
);

const AdminScreen = lazy(() =>
  import('../modules/admin/index.ts').then((m) => ({ default: m.AdminScreen })),
);

/** Lazy: Recharts rides along with the Sim results, and only Sim needs it. */
const SimScreen = lazy(() =>
  import('../modules/sim/index.ts').then((m) => ({ default: m.SimScreen })),
);

/** Lazy for the same reason: MapLibre is ~200 KB and only Live needs it. */
const LiveScreen = lazy(() =>
  import('../modules/live/index.ts').then((m) => ({ default: m.LiveScreen })),
);

function NotFound() {
  return (
    <Box className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
      <Typography variant="overline" color="text.secondary">
        404
      </Typography>
      <Typography variant="h3">That screen does not exist</Typography>
      <Typography variant="body2" color="text.secondary">
        Sign in, Live, Plan, Sim, Fleet, Data and Admin all exist. This path does not.
      </Typography>
    </Box>
  );
}

export const router = createBrowserRouter([
  { path: '/signin', element: <SignInScreen /> },
  {
    path: '/live',
    element: (
      <RequireAuth>
        <AppShell>
          <Suspense fallback={<LoadingState />}>
            <LiveScreen />
          </Suspense>
        </AppShell>
      </RequireAuth>
    ),
  },
  {
    path: '/plan',
    element: (
      <RequireAuth>
        <AppShell>
          <Suspense fallback={<LoadingState />}>
            <PlanScreen />
          </Suspense>
        </AppShell>
      </RequireAuth>
    ),
  },
  {
    path: '/sim',
    element: (
      <RequireAuth>
        <AppShell>
          <Suspense fallback={<LoadingState />}>
            <SimScreen />
          </Suspense>
        </AppShell>
      </RequireAuth>
    ),
  },
  {
    path: '/admin',
    element: (
      <RequireAuth>
        <AppShell>
          <Suspense fallback={<LoadingState />}>
            <AdminScreen />
          </Suspense>
        </AppShell>
      </RequireAuth>
    ),
  },
  {
    path: '/data',
    element: (
      <RequireAuth>
        <AppShell>
          <Suspense fallback={<LoadingState />}>
            <DataScreen />
          </Suspense>
        </AppShell>
      </RequireAuth>
    ),
  },
  {
    path: '/fleet',
    element: (
      <RequireAuth>
        <AppShell>
          <Suspense fallback={<LoadingState />}>
            <FleetScreen />
          </Suspense>
        </AppShell>
      </RequireAuth>
    ),
  },
  { path: '/', element: <Navigate to="/live" replace /> },
  { path: '*', element: <NotFound /> },
]);
