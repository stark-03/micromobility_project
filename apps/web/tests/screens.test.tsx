import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { createAppTheme } from '../src/app/theme.ts';
import { SignInScreen } from '../src/modules/auth/index.ts';
import { LegendCard } from '../src/modules/live/LegendCard.tsx';

const theme = createAppTheme();

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

/**
 * Screen-level smoke tests. These mount real components against the real
 * theme, which is the only way to catch a colour MUI cannot parse — a build
 * and a typecheck both pass happily right up until the component renders.
 */
describe('SignInScreen', () => {
  it('mounts and shows its fields', () => {
    wrap(<SignInScreen />);
    expect(screen.getByLabelText(/email/i)).toBeDefined();
    expect(screen.getByLabelText(/password/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDefined();
  });

  it('disables submit until both fields have a value', () => {
    wrap(<SignInScreen />);
    expect(screen.getByRole('button', { name: /sign in/i })).toHaveProperty('disabled', true);
  });
});

describe('LegendCard', () => {
  it('mounts and renders the congestion ramp and mode keys', () => {
    // The legend is permanent, not a tooltip (design.md §6.4) — if it cannot
    // mount, the map is unreadable.
    wrap(<LegendCard />);
    expect(screen.getByLabelText('Map legend')).toBeDefined();
    expect(screen.getByText('Congestion')).toBeDefined();
    expect(screen.getByText('Scooter')).toBeDefined();
    expect(screen.getByText('Shared EV')).toBeDefined();
  });
});
