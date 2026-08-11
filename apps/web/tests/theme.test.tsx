import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  Alert,
  Button,
  Chip,
  CssBaseline,
  Switch,
  TextField,
  ThemeProvider,
  Tooltip,
  Typography,
} from '@mui/material';
import { createAppTheme } from '../src/app/theme.ts';
import { token } from '../src/lib/tokens.ts';

const theme = createAppTheme();

/**
 * Regression tests for a crash that reached the browser:
 *
 *   "MUI: Unsupported `var(--mist-100)` color"
 *
 * design.md §6.8 writes the palette as var() strings. createTheme tolerates
 * that far enough to build, but components call alpha(theme.palette.…) while
 * RENDERING, and alpha() must parse the value. A build-only check cannot catch
 * it — you have to mount something.
 */
describe('theme palette', () => {
  it('resolves every palette colour to a literal MUI can parse', () => {
    const literal = /^(#|rgb|hsl|color\()/;
    const p = theme.palette;

    for (const [name, value] of [
      ['background.default', p.background.default],
      ['background.paper', p.background.paper],
      ['text.primary', p.text.primary],
      ['text.secondary', p.text.secondary],
      ['divider', p.divider],
      ['primary.main', p.primary.main],
      ['secondary.main', p.secondary.main],
      ['error.main', p.error.main],
      ['warning.main', p.warning.main],
      ['info.main', p.info.main],
      ['success.main', p.success.main],
    ] as const) {
      expect(String(value), name).toMatch(literal);
      expect(String(value), name).not.toContain('var(');
    }
  });

  it('takes its values from tokens.css, not from hardcoded hex', () => {
    // If someone pastes a literal into theme.ts, this drifts and fails.
    expect(theme.palette.background.default).toBe(token('--ink-950'));
    expect(theme.palette.text.primary).toBe(token('--mist-100'));
    expect(theme.palette.primary.main).toBe(token('--info'));
  });

  it('renders the components that call alpha() during render', () => {
    // Switch, Chip and Alert were the ones that actually crashed the Live screen.
    expect(() =>
      render(
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <Switch checked onChange={() => undefined} />
          <Chip label="Available" variant="outlined" />
          <Alert severity="error">boom</Alert>
          <Button variant="contained">Sign in</Button>
          <TextField label="Email" />
          <Tooltip title="Live arrives in Sprint 2">
            <span>rail item</span>
          </Tooltip>
          <Typography variant="overline">Congestion</Typography>
        </ThemeProvider>,
      ),
    ).not.toThrow();
  });
});
