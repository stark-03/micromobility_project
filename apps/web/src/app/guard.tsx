import { useEffect, useState } from 'react';
import { Link as RouterLink, Navigate, useLocation } from 'react-router-dom';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import type { Role } from '@mm/shared-types';
import { homeFor } from '../lib/access.ts';
import { api } from '../lib/api.ts';
import { useAuthStore } from '../lib/auth-store.ts';

/**
 * Route guard.
 *
 * On a cold load the access token is gone (it only ever lived in memory), but
 * the httpOnly refresh cookie may still be valid — so try one silent refresh
 * before deciding the user is signed out. Without this, every page reload
 * bounces to sign-in even with a live session.
 *
 * The frontend hides UI it cannot use, but is never the gate. Every one of
 * these checks is enforced again server-side (design.md §7).
 */
/** `/` sends each role to its own main screen. */
export function HomeRedirect() {
  const roles = useAuthStore((s) => s.user?.roles);
  return <Navigate to={homeFor(roles)} replace />;
}

export function RequireAuth({
  children,
  roles,
}: {
  children: React.ReactNode;
  roles?: readonly Role[];
}) {
  const { accessToken, user, bootstrapping, finishBootstrap } = useAuthStore();
  const [attempted, setAttempted] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (accessToken || attempted) return;
    let cancelled = false;
    void api.restoreSession().finally(() => {
      if (cancelled) return;
      setAttempted(true);
      finishBootstrap();
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken, attempted, finishBootstrap]);

  if (!accessToken && (bootstrapping || !attempted)) {
    return (
      <Box className="flex min-h-screen items-center justify-center">
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (!accessToken) {
    return <Navigate to="/signin" state={{ from: location.pathname }} replace />;
  }

  if (roles && !roles.some((r) => user?.roles.includes(r))) {
    return (
      <Box className="flex min-h-screen flex-col items-center justify-center gap-2 p-8 text-center">
        <Typography variant="overline" color="text.secondary">
          403
        </Typography>
        <Typography variant="h3">You do not have access to this area</Typography>
        <Typography variant="body2" color="text.secondary">
          This screen needs one of: {roles.join(', ')}.
        </Typography>
        <Button component={RouterLink} to={homeFor(user?.roles)} variant="outlined" className="mt-2">
          Go to my home screen
        </Button>
      </Box>
    );
  }

  return <>{children}</>;
}
