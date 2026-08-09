import { createTheme } from '@mui/material/styles';
// Side-effect import: teaches MUI's `Components` type about MuiDataGrid, which
// otherwise is not a known theme key and fails the build.
import '@mui/x-data-grid/themeAugmentation';

/**
 * MUI theme. Every value is a `var(--…)` reference into styles/tokens.css —
 * there is no hex literal in this file or in any component.
 *
 * Note on the explicit light/dark/contrastText below: MUI's `augmentColor`
 * fills in any missing shade by calling `lighten()`/`darken()`, and computes
 * contrastText via `getContrastRatio()`. Both parse the colour string, and
 * neither can parse `var(--info)` — createTheme throws at import time. Supplying
 * all four keys means MUI never needs to decompose the value, which is what
 * keeps the design.md §6.8 approach working in practice.
 */
export const theme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: 'var(--ink-950)', paper: 'var(--ink-800)' },
    text: {
      primary: 'var(--mist-100)',
      secondary: 'var(--mist-400)',
      disabled: 'var(--mist-400)',
    },
    divider: 'var(--ink-700)',
    primary: {
      main: 'var(--info)',
      light: 'var(--info)',
      dark: 'var(--info)',
      contrastText: 'var(--ink-950)',
    },
    secondary: {
      main: 'var(--line-bike)',
      light: 'var(--line-bike)',
      dark: 'var(--line-bike)',
      contrastText: 'var(--ink-950)',
    },
    error: {
      main: 'var(--danger)',
      light: 'var(--danger)',
      dark: 'var(--danger)',
      contrastText: 'var(--mist-100)',
    },
    warning: {
      main: 'var(--warn)',
      light: 'var(--warn)',
      dark: 'var(--warn)',
      contrastText: 'var(--ink-950)',
    },
    info: {
      main: 'var(--info)',
      light: 'var(--info)',
      dark: 'var(--info)',
      contrastText: 'var(--ink-950)',
    },
    success: {
      main: 'var(--ok)',
      light: 'var(--ok)',
      dark: 'var(--ok)',
      contrastText: 'var(--ink-950)',
    },
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
        body: {
          backgroundColor: 'var(--ink-950)',
          color: 'var(--mist-100)',
        },
        // Any number that changes in place — ETA, battery %, live counts — is
        // mono with tabular figures so it does not jitter (design.md §6.3).
        '.mono': {
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
        },
        // Visible focus rings everywhere, 2px --info (design.md §6.7).
        ':focus-visible': {
          outline: '2px solid var(--info)',
          outlineOffset: 2,
        },
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
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 'var(--r-sm)', fontWeight: 500 },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 'var(--r-md)' },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: 'var(--ink-700)',
          color: 'var(--mist-100)',
          fontSize: 12,
        },
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
        columnHeaders: { backgroundColor: 'var(--ink-900)' },
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
