import { CssBaseline, StyledEngineProvider, ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

// Self-hosted fonts — no CDN request, so the app works offline.
import '@fontsource/archivo/600.css';
import '@fontsource/archivo/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/ibm-plex-mono/400.css';

// MUST come before createAppTheme(): the theme reads its palette out of the
// computed styles, so the tokens have to be in the document first.
import './styles/tailwind.css';

import { router } from './app/router.tsx';
import { createAppTheme } from './app/theme.ts';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

const theme = createAppTheme();

createRoot(root).render(
  // injectFirst puts MUI's styles before Tailwind's in the cascade, so a
  // Tailwind utility on a wrapper wins without !important (design.md §6.8).
  <StyledEngineProvider injectFirst>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  </StyledEngineProvider>,
);
