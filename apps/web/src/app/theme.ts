import { createTheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
// Side-effect import: teaches MUI's `Components` type about MuiDataGrid, which
// otherwise is not a known theme key and fails the build.
import '@mui/x-data-grid/themeAugmentation';
import { token } from '../lib/tokens.ts';

/**
 * MUI theme, built from the design tokens at startup.
 *
 * `docs/design.md` §6.8 shows the palette written as `var(--ink-950)` strings.
 * That does not work with MUI v5 and it fails at RUNTIME, not at build:
 *
 *   - `createTheme` runs `augmentColor` on every palette colour, which calls
 *     `lighten()` / `darken()` / `getContrastRatio()` for any missing shade.
 *   - Worse, individual components call `alpha(theme.palette.text.primary, …)`
 *     while rendering — Switch, Chip and DataGrid all do.
 *
 * Both paths run the value through `decomposeColor()`, which throws
 * "Unsupported `var(--mist-100)` color" on anything that is not a literal.
 * Supplying explicit light/dark/contrastText only silences the first path; the
 * second still crashes the moment such a component mounts.
 *
 * So the palette is resolved to concrete values here, read out of the
 * stylesheet with `getComputedStyle`. `tokens.css` remains the single source of
 * truth — change a token and the theme follows on next load — and MUI gets
 * strings it can actually parse.
 *
 * Note that `styleOverrides` below still use `var(--…)` freely: those are
 * emitted as plain CSS and resolved by the browser, never by MUI's colour
 * manipulation. Only *palette* values must be literal.
 *
 * Must be called AFTER tokens.css is in the document — see main.tsx.
 */
export function createAppTheme(): Theme {
  const ink950 = token('--ink-950');
  const ink900 = token('--ink-900');
  const ink800 = token('--ink-800');
  const ink700 = token('--ink-700');
  const mist400 = token('--mist-400');
  const mist100 = token('--mist-100');
  const info = token('--info');
  const ok = token('--ok');
  const warn = token('--warn');
  const danger = token('--danger');
  const bike = token('--line-bike');

  return createTheme({
    palette: {
      mode: 'dark',
      background: { default: ink950, paper: ink800 },
      text: { primary: mist100, secondary: mist400, disabled: mist400 },
      divider: ink700,
      primary: { main: info, contrastText: ink950 },
      secondary: { main: bike, contrastText: ink950 },
      error: { main: danger, contrastText: mist100 },
      warning: { main: warn, contrastText: ink950 },
      info: { main: info, contrastText: ink950 },
      success: { main: ok, contrastText: ink950 },
    },

    shape: { borderRadius: 8 },

    typography: {
      fontFamily: 'var(--font-body)',
      h1: { fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '-0.02em' },
      h2: { fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '-0.02em' },
      h3: { fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '-0.01em' },
      // Section headers read as signage — uppercase, wide tracking, small.
      overline: {
        fontFamily: 'var(--font-display)',
        fontWeight: 600,
        letterSpacing: '0.08em',
        fontSize: 12,
        textTransform: 'uppercase',
      },
      body1: { fontSize: 15, lineHeight: 1.55 },
      body2: { fontSize: 14, lineHeight: 1.55 },
      button: { textTransform: 'none', fontWeight: 500 },
    },

    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { backgroundColor: 'var(--ink-950)', color: 'var(--mist-100)' },
          // Any number that changes in place — ETA, battery %, live counts — is
          // mono with tabular figures so it does not jitter (design.md §6.3).
          '.mono': { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' },
          // Visible focus rings everywhere, 2px --info (design.md §6.7).
          ':focus-visible': { outline: '2px solid var(--info)', outlineOffset: 2 },
          '@media (prefers-reduced-motion: reduce)': {
            '*': {
              animationDuration: '0.01ms !important',
              transitionDuration: '0.01ms !important',
            },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundColor: 'var(--ink-800)',
            backgroundImage: 'none',
            border: '1px solid var(--ink-700)',
          },
        },
      },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: 'var(--ink-900)',
            '& fieldset': { borderColor: 'var(--ink-700)' },
            '&:hover fieldset': { borderColor: 'var(--mist-400)' },
          },
        },
      },
      MuiChip: { styleOverrides: { root: { borderRadius: 'var(--r-sm)', fontWeight: 500 } } },
      MuiButton: { styleOverrides: { root: { borderRadius: 'var(--r-md)' } } },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { backgroundColor: ink700, color: mist100, fontSize: 12 },
        },
      },
      MuiDataGrid: {
        styleOverrides: {
          root: {
            border: '1px solid var(--ink-700)',
            borderRadius: 'var(--r-md)',
            backgroundColor: 'var(--ink-800)',
            '--DataGrid-rowBorderColor': 'var(--ink-700)',
          },
          columnHeaders: { backgroundColor: ink900 },
          columnHeaderTitle: {
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            fontSize: 11,
          },
          cell: { borderColor: 'var(--ink-700)' },
          footerContainer: { borderColor: 'var(--ink-700)' },
        },
      },
    },
  });
}
