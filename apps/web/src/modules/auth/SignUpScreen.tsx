import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Alert, Box, Button, Link, Paper, TextField, Typography } from '@mui/material';
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
    case 'EMAIL_ALREADY_REGISTERED':
      return 'That email already has an account. Sign in instead.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Try again in 15 minutes.';
    case 'NETWORK_ERROR':
      return 'Could not reach the server. Is the API running on port 4000?';
    case 'VALIDATION_FAILED':
      return error.details?.map((d) => d.message).join(' ') ?? 'Check the fields above.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

/** Mirrors the server's passwordSchema so the rule is visible before submitting. */
function passwordProblem(value: string): string | null {
  if (value.length === 0) return null;
  if (value.length < 10) return 'At least 10 characters';
  if (!/[a-zA-Z]/.test(value)) return 'Needs a letter';
  if (!/[0-9]/.test(value)) return 'Needs a digit';
  return null;
}

export function SignUpScreen() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();

  const signUp = useMutation({
    mutationFn: () =>
      api.post<AuthResponseDto>('/auth/register', {
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        // Optional server-side; sent only when given, because an empty string
        // fails the min-length rule and would reject an otherwise valid signup.
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      }),
    onSuccess: (res) => {
      // Register already returns an access token and sets the refresh cookie,
      // so a new rider lands signed in rather than being bounced to a login
      // form to retype what they just typed.
      setSession(res.data.accessToken, res.data.user);
      navigate('/live', { replace: true });
    },
  });

  const pwProblem = passwordProblem(password);
  const canSubmit =
    fullName.trim().length >= 2 &&
    /.+@.+\..+/.test(email) &&
    password.length >= 10 &&
    pwProblem === null &&
    !signUp.isPending;

  return (
    <Box className="flex min-h-screen items-center justify-center bg-ink-950 p-4">
      <Paper elevation={0} className="w-full max-w-md p-7 shadow-card">
        <Box className="mb-6 flex items-center gap-3">
          <Box className="h-6 w-1 rounded-sm bg-line-scooter" aria-hidden />
          <Box>
            <Typography variant="overline" color="text.secondary" className="leading-none">
              AI Urban Micro Mobility
            </Typography>
            <Typography variant="h2" sx={{ fontSize: 24 }}>
              Create your account
            </Typography>
          </Box>
        </Box>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) signUp.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <TextField
            label="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            size="small"
            fullWidth
            autoFocus
            autoComplete="name"
            required
          />

          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            size="small"
            fullWidth
            autoComplete="email"
            required
          />

          <TextField
            label="Mobile (optional)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            size="small"
            fullWidth
            autoComplete="tel"
            placeholder="+91 98765 43210"
          />

          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            size="small"
            fullWidth
            autoComplete="new-password"
            required
            error={pwProblem !== null}
            helperText={pwProblem ?? 'At least 10 characters, with a letter and a digit'}
          />

          {signUp.isError && (
            <Alert severity="error" variant="outlined">
              {messageFor(signUp.error as ApiClientError)}
            </Alert>
          )}

          <Button type="submit" variant="contained" size="large" disabled={!canSubmit} fullWidth>
            {signUp.isPending ? 'Creating account…' : 'Create account & view the map'}
          </Button>
        </form>

        <Typography variant="body2" color="text.secondary" className="mt-5 text-center">
          Already have an account?{' '}
          <Link component={RouterLink} to="/signin">
            Sign in
          </Link>
        </Typography>

        <Typography variant="caption" color="text.secondary" className="mt-4 block text-center">
          New accounts join as riders — you can plan journeys and see live traffic. Planning and
          operations screens need a role an administrator grants.
        </Typography>
      </Paper>
    </Box>
  );
}
