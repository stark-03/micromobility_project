import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { VEHICLE_TYPES } from '@mm/shared-types';
import type { RouteCompareDto, RouteDto, VehicleType, ZoneDto } from '@mm/shared-types';
import { api } from '../../lib/api.ts';
import type { ApiClientError } from '../../lib/api.ts';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews.tsx';
import { flowRamp } from '../../lib/tokens.ts';

const PROFILE_BLURB: Record<string, string> = {
  fastest: 'Minimises time. Tolerates busy roads and hills.',
  safest: 'Prefers lit streets, bike lanes and quieter roads.',
  greenest: 'Avoids climbing and heavy traffic to save energy.',
};

/** A metric that says which route wins on this measure, and by how much. */
function Comparison({
  label,
  value,
  unit,
  best,
  lowerIsBetter = true,
}: {
  label: string;
  value: number;
  unit: string;
  best: number;
  lowerIsBetter?: boolean;
}) {
  const isBest = lowerIsBetter ? value <= best : value >= best;
  const delta = value - best;
  const pct = best === 0 ? 0 : Math.abs(delta / best) * 100;

  return (
    <Box className="flex flex-col">
      <Typography variant="overline" color="text.secondary" className="leading-none">
        {label}
      </Typography>
      <Typography
        variant="h3"
        className="mono leading-tight"
        sx={{ fontSize: 22, color: isBest ? 'var(--ok)' : 'var(--mist-100)' }}
      >
        {value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
        <Typography component="span" variant="caption" color="text.secondary" className="ml-1">
          {unit}
        </Typography>
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {isBest ? 'best' : `+${pct.toFixed(0)}%`}
      </Typography>
    </Box>
  );
}

function RouteCard({ route, bests }: { route: RouteDto; bests: Record<string, number> }) {
  const ramp = flowRamp();
  const band = Math.min(4, Math.floor(route.meanCongestion * 5));

  return (
    <Paper elevation={0} className="flex flex-col gap-3 p-4 shadow-card">
      <Box className="flex items-center justify-between gap-2">
        <Box>
          <Typography variant="h3" sx={{ fontSize: 18, textTransform: 'capitalize' }}>
            {route.profile}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {PROFILE_BLURB[route.profile]}
          </Typography>
        </Box>
        <Chip
          size="small"
          variant="outlined"
          label={`${route.steps.length} roads`}
          sx={{ color: ramp[band], borderColor: ramp[band] }}
        />
      </Box>

      <Box className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Comparison label="ETA" value={route.etaMinutes} unit="min" best={bests.eta!} />
        <Comparison
          label="Distance"
          value={route.distanceM / 1000}
          unit="km"
          best={bests.distance!}
        />
        <Comparison label="Risk" value={route.riskScore} unit="/100" best={bests.risk!} />
        <Comparison label="Climb" value={route.elevationGainM} unit="m" best={bests.climb!} />
      </Box>

      <Box className="flex flex-wrap gap-x-6 gap-y-1 border-t border-ink-700 pt-2">
        <Typography variant="caption" color="text.secondary">
          Energy <span className="mono">{route.energyWh.toFixed(0)} Wh</span>
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Mean congestion <span className="mono">{route.meanCongestion.toFixed(2)}</span>
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Snapped <span className="mono">{route.snapDistanceM.toFixed(0)} m</span>
        </Typography>
      </Box>

      <Box>
        <Typography variant="overline" color="text.secondary">
          Turn list
        </Typography>
        <Box className="mt-1 flex flex-col gap-0.5">
          {route.steps.map((s, i) => {
            const stepBand = Math.min(4, Math.floor(s.congestionIndex * 5));
            return (
              <Box key={`${s.segmentId}-${i}`} className="flex items-center gap-2">
                <Box
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  sx={{ backgroundColor: ramp[stepBand] }}
                  aria-hidden
                />
                <Typography variant="caption" className="flex-1 truncate">
                  {s.name ?? `Segment ${s.segmentId}`}
                </Typography>
                <Typography variant="caption" color="text.secondary" className="mono">
                  {Math.round(s.lengthM)} m
                </Typography>
                <Typography variant="caption" color="text.secondary" className="mono w-12 text-right">
                  {Math.round(s.durationS)} s
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Paper>
  );
}

export function PlanScreen() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mode, setMode] = useState<VehicleType>('scooter');

  const zones = useQuery({
    queryKey: ['geo', 'zones'],
    queryFn: () => api.get<ZoneDto[]>('/geo/zones'),
    staleTime: 60 * 60 * 1000,
  });

  const compare = useMutation({
    mutationFn: () => {
      const list = zones.data?.data ?? [];
      const origin = list.find((z) => z.id === from)!.centroid.coordinates;
      const destination = list.find((z) => z.id === to)!.centroid.coordinates;
      return api.post<RouteCompareDto>('/routes/compare', { origin, destination, mode });
    },
  });

  if (zones.isLoading) return <LoadingState rows={4} />;
  if (zones.isError) {
    return <ErrorState error={zones.error as ApiClientError} onRetry={() => void zones.refetch()} />;
  }

  const zoneList = zones.data!.data;
  const routes = compare.data?.data.routes ?? [];
  const error = compare.error as ApiClientError | null;

  const bests = {
    eta: Math.min(...routes.map((r) => r.etaMinutes)),
    distance: Math.min(...routes.map((r) => r.distanceM / 1000)),
    risk: Math.min(...routes.map((r) => r.riskScore)),
    climb: Math.min(...routes.map((r) => r.elevationGainM)),
  };

  return (
    <Box className="flex flex-col gap-4 p-6">
      <Box>
        <Typography variant="overline" color="text.secondary">
          Plan a trip
        </Typography>
        <Typography variant="h2" sx={{ fontSize: 30 }}>
          Route comparison
        </Typography>
        <Typography variant="body2" color="text.secondary" className="mt-1 max-w-2xl">
          A* over the live road graph, with current congestion folded into every edge cost. The
          three profiles weight time, safety and energy differently — the point is what each
          choice costs you.
        </Typography>
      </Box>

      <Paper elevation={0} className="flex flex-wrap items-end gap-3 p-4">
        <TextField
          select
          label="From"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          sx={{ minWidth: 190 }}
        >
          {zoneList.map((z) => (
            <MenuItem key={z.id} value={z.id} disabled={z.id === to}>
              {z.name}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label="To"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          sx={{ minWidth: 190 }}
        >
          {zoneList.map((z) => (
            <MenuItem key={z.id} value={z.id} disabled={z.id === from}>
              {z.name}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label="Mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as VehicleType)}
          sx={{ minWidth: 160 }}
        >
          {VEHICLE_TYPES.map((t) => (
            <MenuItem key={t} value={t}>
              {t}
            </MenuItem>
          ))}
        </TextField>

        <Button
          variant="contained"
          size="large"
          disabled={!from || !to || compare.isPending}
          onClick={() => compare.mutate()}
        >
          {compare.isPending ? 'Planning…' : 'Compare routes'}
        </Button>
      </Paper>

      {error && (
        <ErrorState
          error={error}
          onRetry={error.code === 'SERVICE_UNAVAILABLE' ? () => compare.mutate() : undefined}
        />
      )}

      {!error && routes.length === 0 && !compare.isPending && (
        <EmptyState
          title="No route planned yet"
          action="Pick a start and end zone, then compare. Each profile is planned independently over the same live graph."
        />
      )}

      {routes.length > 0 && (
        <Box className="grid gap-4 lg:grid-cols-3">
          {routes.map((r) => (
            <RouteCard key={r.profile} route={r} bests={bests} />
          ))}
        </Box>
      )}
    </Box>
  );
}
