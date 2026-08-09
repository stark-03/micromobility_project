import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Alert, Box, Button, Paper, TextField, Typography } from '@mui/material';
import type { AuthResponseDto } from '@mm/shared-types';
import { api } from '../../lib/api.ts';
import type { ApiClientError } from '../../lib/api.ts';
import { useAuthStore } from '../../lib/auth-store.ts';

/**
 * Maps an error CODE to a human message. Never switches on `message` — codes
 * are the stable contract; messages are for humans and can change (CLAUDE.md).
 */
function messageFor(error: ApiClientError): string {
  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return 'That email and password don’t match.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Try again in 15 minutes.';
    case 'FORBIDDEN':
      return 'This account is not active. Contact an administrator.';
    case 'NETWORK_ERROR':
      return 'Could not reach the server. Is the API running on port 4000?';
    case 'VALIDATION_FAILED':
      return error.details?.map((d) => d.message).join(' ') ?? 'Check the fields above.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

export function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/fleet';

  const signIn = useMutation({
    mutationFn: () => api.post<AuthResponseDto>('/auth/login', { email, password }),
    onSuccess: (res) => {
      setSession(res.data.accessToken, res.data.user);
      navigate(from, { replace: true });
    },
  });

  const error = signIn.error as ApiClientError | null;
  const fieldError = (path: string) =>
    error?.code === 'VALIDATION_FAILED'
      ? error.details?.find((d) => d.path === path)?.message
      : undefined;

  return (
    <Box className="flex min-h-screen items-center justify-center bg-ink-950 p-4">
      <Paper className="w-full max-w-md p-8 shadow-card" elevation={0}>
        <Box className="mb-6 flex items-center gap-3">
          <Box className="h-5 w-1 rounded-sm bg-line-scooter" aria-hidden />
          <Typography variant="overline" color="text.secondary">
            AI Urban Micro Mobility
          </Typography>
        </Box>

        <Typography variant="h2" className="mb-1" sx={{ fontSize: 28 }}>
          Sign in
        </Typography>
        <Typography variant="body2" color="text.secondary" className="mb-6">
          Belagavi simulator — planner, operator and analyst access.
        </Typography>

        <Box
          component="form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            signIn.mutate();
          }}
        >
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            fullWidth
            error={Boolean(fieldError('email'))}
            helperText={fieldError('email')}
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            fullWidth
            error={Boolean(fieldError('password'))}
            helperText={fieldError('password')}
          />

          {error && <Alert severity="error">{messageFor(error)}</Alert>}

          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={signIn.isPending || !email || !password}
          >
            {signIn.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </Box>

        <Typography variant="caption" color="text.secondary" className="mt-6 block">
          Demo accounts are printed once by <span className="mono">npm run db:seed</span>.
        </Typography>
      </Paper>
    </Box>
  );
}
