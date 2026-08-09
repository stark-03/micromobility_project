import { useNavigate } from 'react-router-dom';
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
import { api } from '../lib/api.ts';
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
 * design.md §6.4 order. Only Fleet is built in Sprint 1; the other five render
 * disabled with a tooltip naming their sprint.
 *
 * Showing them is deliberate: hiding the product's real shape makes the app
 * look smaller than it is, and faking working links is worse. A disabled item
 * that says when it arrives is honest.
 */
const DESTINATIONS: Destination[] = [
  { key: 'live', label: 'Live', icon: <MapOutlined />, arrives: 'Sprint 2' },
  { key: 'plan', label: 'Plan', icon: <ExploreOutlined />, arrives: 'Sprint 3' },
  { key: 'sim', label: 'Sim', icon: <HexagonOutlined />, arrives: 'Sprint 4' },
  { key: 'fleet', label: 'Fleet', icon: <TwoWheelerOutlined />, path: '/fleet' },
  { key: 'data', label: 'Data', icon: <InsertChartOutlined />, arrives: 'Sprint 5' },
  { key: 'admin', label: 'Admin', icon: <SettingsOutlined />, arrives: 'Sprint 6' },
];

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
