import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Button, Tooltip, Typography } from '@mui/material';
// Named imports from the package root, not deep paths: @mui/icons-material's
// per-icon files have no `exports` entry, so `moduleResolution: nodenext`
// cannot resolve them. Vite tree-shakes the barrel in the production build.
import {
  ExploreOutlined,
  HexagonOutlined,
  InsertChartOutlined,
  MapOutlined,
  SettingsOutlined,
  TwoWheelerOutlined,
} from '@mui/icons-material';
import type { WeatherDto } from '@mm/shared-types';
import { api } from '../lib/api.ts';
import { useRealtime } from '../lib/use-realtime.ts';
import { useAuthStore } from '../lib/auth-store.ts';

interface Destination {
  key: string;
  label: string;
  icon: React.ReactNode;
  path?: string;
  /** Absent for the one screen that exists; otherwise names the sprint. */
  arrives?: string;
}

/**
 * design.md §6.4 order. Only Sim and Admin remain unbuilt; they render
 * disabled with a tooltip naming their sprint.
 *
 * Showing them is deliberate: hiding the product's real shape makes the app
 * look smaller than it is, and faking working links is worse. A disabled item
 * that says when it arrives is honest.
 */
const DESTINATIONS: Destination[] = [
  { key: 'live', label: 'Live', icon: <MapOutlined />, path: '/live' },
  { key: 'plan', label: 'Plan', icon: <ExploreOutlined />, path: '/plan' },
  { key: 'sim', label: 'Sim', icon: <HexagonOutlined />, arrives: 'Sprint 4' },
  { key: 'fleet', label: 'Fleet', icon: <TwoWheelerOutlined />, path: '/fleet' },
  { key: 'data', label: 'Data', icon: <InsertChartOutlined />, path: '/data' },
  { key: 'admin', label: 'Admin', icon: <SettingsOutlined />, arrives: 'Sprint 6' },
];

const CONDITION_GLYPH: Record<string, string> = {
  clear: '\u2600',
  cloudy: '\u2601',
  light_rain: '\u2602',
  heavy_rain: '\u2614',
};

/** design.md 6.4: weather sits in the map header, beside the clock. */
function WeatherStrip() {
  const weather = useQuery({
    queryKey: ['weather', 'current'],
    queryFn: () => api.get<WeatherDto[]>('/weather/current'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const readings = weather.data?.data ?? [];
  if (readings.length === 0) return null;

  // City figure = mean across zones, so the header does not privilege one zone.
  const mean = readings.reduce((n, r) => n + (r.tempC ?? 0), 0) / readings.length;
  const wettest = readings.reduce((a, b) => ((b.precipitationMm ?? 0) > (a.precipitationMm ?? 0) ? b : a));
  const glyph = CONDITION_GLYPH[wettest.conditionCode ?? 'clear'] ?? '\u2601';

  return (
    <Tooltip title={`${wettest.zoneName}: ${wettest.conditionCode ?? 'unknown'}`}>
      <Typography variant="body2" className="mono hidden whitespace-nowrap lg:block" color="text.secondary">
        {glyph} {mean.toFixed(1)}°C
      </Typography>
    </Tooltip>
  );
}

function TopBar() {
  const { user, clear } = useAuthStore();
  const navigate = useNavigate();

  async function signOut() {
    try {
      await api.post('/auth/logout');
    } finally {
      clear();
      navigate('/signin', { replace: true });
    }
  }

  return (
    <Box
      component="header"
      className="fixed inset-x-0 top-0 z-20 flex h-topbar items-center gap-3 border-b border-ink-700 bg-ink-900 px-4"
    >
      <Box className="h-5 w-1 rounded-sm bg-line-scooter" aria-hidden />
      <Typography variant="overline" className="whitespace-nowrap">
        AI Urban Micro Mobility
      </Typography>

      <Box className="flex-1" />

      <WeatherStrip />
      {user && (
        <>
          <Typography variant="body2" color="text.secondary" className="hidden sm:block">
            {user.fullName}
          </Typography>
          <Typography
            variant="body2"
            className="mono hidden rounded-sm border border-ink-700 px-2 py-0.5 md:block"
            color="text.secondary"
          >
            {user.roles.join(' · ')}
          </Typography>
          <Button size="small" variant="text" onClick={() => void signOut()}>
            Sign out
          </Button>
        </>
      )}
    </Box>
  );
}

function IconRail() {
  const navigate = useNavigate();

  return (
    <Box
      component="nav"
      aria-label="Primary"
      className="fixed bottom-0 left-0 top-topbar z-10 flex w-rail flex-col items-center gap-1 border-r border-ink-700 bg-ink-900 py-3"
    >
      {DESTINATIONS.map((d) => {
        const enabled = Boolean(d.path);
        const item = (
          <Box
            component="button"
            key={d.key}
            type="button"
            disabled={!enabled}
            aria-disabled={!enabled}
            onClick={enabled ? () => navigate(d.path!) : undefined}
            className={[
              'flex w-12 flex-col items-center gap-1 rounded-md border-0 bg-transparent py-2',
              enabled
                ? 'cursor-pointer text-mist-100 hover:bg-ink-800'
                : 'cursor-not-allowed text-mist-400 opacity-40',
            ].join(' ')}
          >
            {d.icon}
            <Typography variant="caption" className="leading-none">
              {d.label}
            </Typography>
          </Box>
        );

        return enabled ? (
          item
        ) : (
          <Tooltip key={d.key} title={`${d.label} arrives in ${d.arrives}`} placement="right">
            <span>{item}</span>
          </Tooltip>
        );
      })}
    </Box>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  // One socket for the whole shell; screens just react to invalidated queries.
  useRealtime();

  return (
    <Box className="min-h-screen bg-ink-950">
      <TopBar />
      <IconRail />
      <Box component="main" className="ml-rail pt-topbar">
        {children}
      </Box>
    </Box>
  );
}
