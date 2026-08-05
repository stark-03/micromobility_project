/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // MUI's CssBaseline owns the reset. StyledEngineProvider injectFirst puts
  // MUI's styles first in the cascade so a Tailwind utility on a wrapper wins
  // ties without !important.
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        ink: {
          950: 'var(--ink-950)',
          900: 'var(--ink-900)',
          800: 'var(--ink-800)',
          700: 'var(--ink-700)',
        },
        mist: { 400: 'var(--mist-400)', 100: 'var(--mist-100)' },
        line: {
          scooter: 'var(--line-scooter)',
          bike: 'var(--line-bike)',
          ebike: 'var(--line-ebike)',
          ev: 'var(--line-ev)',
        },
        flow: {
          0: 'var(--flow-0)',
          1: 'var(--flow-1)',
          2: 'var(--flow-2)',
          3: 'var(--flow-3)',
          4: 'var(--flow-4)',
        },
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
        info: 'var(--info)',
      },
      fontFamily: {
        display: ['var(--font-display)'],
        sans: ['var(--font-body)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: { sm: 'var(--r-sm)', md: 'var(--r-md)', lg: 'var(--r-lg)' },
      spacing: { topbar: 'var(--topbar-h)', rail: 'var(--rail-w)' },
      boxShadow: { card: 'var(--shadow-card)' },
    },
  },
  plugins: [],
};
