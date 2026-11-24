import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import type { Role, UserDto } from '@mm/shared-types';
import { createAppTheme } from '../src/app/theme.ts';
import { SignInScreen } from '../src/modules/auth/index.ts';
import { UsersPanel } from '../src/modules/admin/UsersPanel.tsx';
import { useAuthStore } from '../src/lib/auth-store.ts';

const theme = createAppTheme();

function user(roles: Role[], extra: Partial<UserDto> = {}): UserDto {
  return {
    id: '1',
    email: `${roles[0]}@belagavi.local`,
    fullName: `A ${roles[0]}`,
    phone: null,
    status: 'active',
    roles,
    operatorId: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

/** Renders the sign-in screen plus a marker page for every dashboard. */
function signInApp(start = '/signin', state?: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const dash = (name: string) => <div>dashboard:{name}</div>;
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[{ pathname: start, state }]}>
          <Routes>
            <Route path="/signin" element={<SignInScreen />} />
            <Route path="/admin" element={dash('admin')} />
            <Route path="/fleet" element={dash('fleet')} />
            <Route path="/sim" element={dash('sim')} />
            <Route path="/data" element={dash('data')} />
            <Route path="/ride" element={dash('ride')} />
            <Route path="/trips" element={dash('trips')} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

function respondWithLogin(as: UserDto) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: { accessToken: 'tok', user: as } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

async function signIn() {
  fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'x@belagavi.local' } });
  fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'secret-pass' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  useAuthStore.getState().clear();
});

describe('after signing in', () => {
  it.each([
    ['admin', 'admin'],
    ['operator', 'fleet'],
    ['planner', 'sim'],
    ['analyst', 'data'],
    ['commuter', 'ride'],
  ] as Array<[Role, string]>)('a %s lands on their own dashboard', async (role, dashboard) => {
    respondWithLogin(user([role]));
    signInApp();
    await signIn();
    expect(await screen.findByText(`dashboard:${dashboard}`)).toBeDefined();
  });

  it('returns someone to the page they were sent to, if their role can open it', async () => {
    respondWithLogin(user(['commuter']));
    signInApp('/signin', { from: '/trips' });
    await signIn();
    expect(await screen.findByText('dashboard:trips')).toBeDefined();
  });

  it('ignores a page their role cannot open and uses their dashboard instead', async () => {
    respondWithLogin(user(['commuter']));
    signInApp('/signin', { from: '/admin' });
    await signIn();
    expect(await screen.findByText('dashboard:ride')).toBeDefined();
  });

  it('skips the sign-in form for someone already signed in', () => {
    useAuthStore.getState().setSession('tok', user(['admin']));
    signInApp();
    expect(screen.getByText('dashboard:admin')).toBeDefined();
  });
});

describe('the admin Users tab', () => {
  it('lists users and requires a company before granting the operator role', async () => {
    useAuthStore.getState().setSession('tok', user(['admin'], { id: '99' }));
    const signup = user(['commuter'], { id: '5', fullName: 'New Rider', email: 'new@x.test' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        const data = u.includes('/admin/operators')
          ? [{ id: '1', code: 'BGM-MOBI', name: 'Belagavi Mobility Co-op' }]
          : [signup];
        return new Response(JSON.stringify({ data, meta: { total: 1 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <ThemeProvider theme={theme}>
        <QueryClientProvider client={qc}>
          <UsersPanel />
        </QueryClientProvider>
      </ThemeProvider>,
    );

    expect(await screen.findByText('New Rider')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Edit roles' }));
    expect(await screen.findByText(/Signs in to:/)).toBeDefined();
    expect(screen.getByText('Rider home')).toBeDefined();

    fireEvent.click(screen.getByLabelText(/^Operator/));
    // No company chosen yet: saving is blocked and the reason is shown.
    expect(screen.getByRole('button', { name: 'Save roles' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/Required: an operator only ever sees/)).toBeDefined();
    expect(screen.getByText('Fleet operations')).toBeDefined();
  });
});
