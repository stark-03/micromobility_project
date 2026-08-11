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
        Sprints 1-2 ship Sign in, Live and Fleet. The rest of the rail arrives later.
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
