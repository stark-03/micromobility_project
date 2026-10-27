import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import type { LngLat, RentalDto, RentalStationDto, RouteDto } from '@mm/shared-types';
import { api } from '../../lib/api.ts';
import type { ApiClientError } from '../../lib/api.ts';
import { formatDistance, formatDuration, formatMoney } from '../../lib/money.ts';
import { ACTIVE_RENTAL_KEY, useGpsTracking, useSimulatedRide } from './gps.ts';

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn' | 'danger';
}) {
  return (
    <Box className="flex flex-col">
      <Typography variant="overline" color="text.secondary" className="leading-none">
        {label}
      </Typography>
      <Typography
        variant="h3"
        className="mono leading-tight"
        sx={{ fontSize: 20, color: tone ? `var(--${tone})` : 'var(--mist-100)' }}
      >
        {value}
      </Typography>
    </Box>
  );
}

/** Where the vehicle is now: the newest fix, or where the ride began. */
export function currentPosition(rental: RentalDto): LngLat | null {
  return rental.path[rental.path.length - 1] ?? rental.startPosition;
}

/** Seconds since the ride started, ticking locally between server updates. */
function useElapsed(startedAt: string): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, (now - new Date(startedAt).getTime()) / 1000);
}

/** Squared degree distance — enough to pick the nearer of two stations. */
function near(a: LngLat, b: LngLat): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

export function ActiveRide({
  rental,
  destination,
  onPlannedPath,
  onEnded,
}: {
  rental: RentalDto;
  /** Where the rider said they were going, if they did. */
  destination: LngLat | null;
  /** The dashed line on the map while a simulated ride replays. */
  onPlannedPath: (path: LngLat[]) => void;
  onEnded: (rental: RentalDto) => void;
}) {
  const qc = useQueryClient();
  const [shareGps, setShareGps] = useState(false);
  const [targetId, setTargetId] = useState<string>('');
  const gps = useGpsTracking(rental.id, shareGps);
  const sim = useSimulatedRide(rental.id);
  const elapsed = useElapsed(rental.startedAt);
  const here = currentPosition(rental);

  /** Stations to ride to, nearest first from where the vehicle is now. */
  const stations = useQuery({
    // ~1 km grid: the list is re-sorted as the ride moves, not refetched per fix.
    queryKey: ['stations', 'near', 'return', here?.[0].toFixed(2), here?.[1].toFixed(2)],
    queryFn: () =>
      api.get<RentalStationDto[]>(`/stations/near?lng=${here![0]}&lat=${here![1]}&radiusM=8000`),
    enabled: here !== null,
    staleTime: 30_000,
  });
  const returnable = (stations.data?.data ?? []).filter((s) => s.freeDocks > 0);

  useEffect(() => {
    if (!targetId && returnable.length > 0) {
      // Default to the station nearest where the rider is going. Without a
      // destination, the nearest station that is not where the ride began, so
      // a demo ride goes somewhere.
      const pick = destination
        ? [...returnable].sort(
            (a, b) => near(a.location, destination) - near(b.location, destination),
          )[0]!
        : (returnable.find((s) => s.id !== rental.startStation?.id) ?? returnable[0]!);
      setTargetId(pick.id);
    }
  }, [returnable, targetId, rental.startStation?.id, destination]);

  const target = returnable.find((s) => s.id === targetId) ?? null;

  /** Ride to the chosen station along a real route, or straight there if the router is down. */
  const simulate = useMutation({
    mutationFn: async (to: RentalStationDto) => {
      if (!here) return [] as LngLat[];
      try {
        const res = await api.post<RouteDto>('/routes/plan', {
          origin: here,
          destination: to.location,
          mode: rental.vehicle.type,
          profile: 'fastest',
        });
        const line = res.data.geometry.coordinates as LngLat[];
        // The route ends at the road node nearest the station; finish at the station itself.
        return [here, ...line, to.location];
      } catch {
        return [here, to.location];
      }
    },
    onSuccess: (path) => {
      setShareGps(false);
      onPlannedPath(path);
      sim.start(path);
    },
  });

  const end = useMutation({
    mutationFn: () =>
      api.post<RentalDto>(`/rentals/${rental.id}/end`, { position: here ?? undefined }),
    onSuccess: (res) => {
      sim.stop();
      setShareGps(false);
      onPlannedPath([]);
      qc.setQueryData(ACTIVE_RENTAL_KEY, { data: null });
      void qc.invalidateQueries({ queryKey: ['stations'] });
      void qc.invalidateQueries({ queryKey: ['rentals'] });
      onEnded(res.data);
    },
  });

  const endError = end.error as ApiClientError | null;
  const nearest = useMemo(() => {
    if (endError?.code !== 'RETURN_NOT_AT_STATION' || !endError.details) return null;
    const get = (k: string) => endError.details!.find((d) => d.path === k)?.message;
    const id = get('stationId');
    return id
      ? {
          id,
          name: get('stationName') ?? 'the nearest station',
          distanceM: Number(get('distanceM') ?? 0),
        }
      : null;
  }, [endError]);

  const battery = rental.vehicle.battery;
  const batteryTone =
    battery.pct === null
      ? undefined
      : battery.pct < 20
        ? 'danger'
        : battery.pct < 35
          ? 'warn'
          : 'ok';

  return (
    <Paper
      elevation={0}
      className="flex flex-col gap-3 p-4 shadow-card"
      sx={{ borderTop: '3px solid var(--ok)' }}
    >
      <Box className="flex items-center justify-between gap-2">
        <Box>
          <Typography variant="overline" color="text.secondary">
            Ride in progress
          </Typography>
          <Typography variant="h3" sx={{ fontSize: 20, textTransform: 'capitalize' }}>
            {rental.vehicle.type} · {rental.vehicle.externalRef}
          </Typography>
          {rental.startStation && (
            <Typography variant="caption" color="text.secondary">
              From {rental.startStation.name}
            </Typography>
          )}
        </Box>
        <Chip
          size="small"
          color="success"
          label={sim.running ? 'Simulating' : shareGps ? 'GPS live' : 'Live'}
        />
      </Box>

      <Box className="grid grid-cols-2 gap-3">
        <Stat label="Time" value={formatDuration(elapsed)} />
        <Stat label="Distance" value={formatDistance(rental.distanceM)} />
        <Stat
          label="Battery"
          value={
            battery.pct === null
              ? 'n/a'
              : `${battery.pct}% · ${formatDistance(battery.rangeM ?? 0)}`
          }
          tone={batteryTone}
        />
        <Stat label="Fare so far" value={rental.fare ? formatMoney(rental.fare.totalMinor) : '—'} />
      </Box>
      {rental.plan && (
        <Typography variant="caption" color="text.secondary">
          {formatMoney(rental.plan.unlockFeeMinor)} unlock +{' '}
          {formatMoney(rental.plan.perMinuteMinor)}/min. The fare updates with each position update.
        </Typography>
      )}

      {/* ---- tracking ---- */}
      <Box className="flex flex-col gap-2 rounded-md border border-ink-700 p-3">
        <Typography variant="overline" color="text.secondary" className="leading-none">
          Journey tracking
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={shareGps}
              disabled={sim.running}
              onChange={(e) => setShareGps(e.target.checked)}
            />
          }
          label="Share my phone's GPS"
        />
        {shareGps && !gps.error && (
          <Typography variant="caption" color="text.secondary">
            {gps.fixes === 0 ? 'Waiting for the first GPS fix…' : `${gps.fixes} positions sent`}
          </Typography>
        )}
        {gps.error && <Alert severity="warning">{gps.error}</Alert>}

        <Box className="flex flex-wrap items-center gap-2">
          <TextField
            select
            size="small"
            label="Ride to station"
            value={target ? targetId : ''}
            onChange={(e) => setTargetId(e.target.value)}
            className="min-w-[200px] flex-1"
            disabled={sim.running || returnable.length === 0}
          >
            {returnable.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name} · {formatDistance(s.distanceM ?? 0)}
              </MenuItem>
            ))}
          </TextField>
          {sim.running ? (
            <Button variant="outlined" onClick={() => sim.stop()}>
              Pause
            </Button>
          ) : (
            <Button
              variant="outlined"
              disabled={!target || simulate.isPending}
              onClick={() => target && simulate.mutate(target)}
            >
              Simulate ride
            </Button>
          )}
        </Box>
        {sim.running && <LinearProgress variant="determinate" value={sim.progress * 100} />}
        {sim.error && <Alert severity="error">{sim.error}</Alert>}
        <Typography variant="caption" color="text.secondary">
          No GPS on this device? Simulate ride replays the trip along the road network, faster than
          real time, and sends each point as a labelled simulated fix.
        </Typography>
      </Box>

      {/* ---- return ---- */}
      {nearest && (
        <Alert
          severity="warning"
          action={
            <Button
              color="inherit"
              size="small"
              disabled={sim.running}
              onClick={() => {
                const st = returnable.find((s) => s.id === nearest.id);
                if (st) {
                  setTargetId(st.id);
                  simulate.mutate(st);
                }
              }}
            >
              Ride there
            </Button>
          }
        >
          Park at a station to end the ride. {nearest.name} is {formatDistance(nearest.distanceM)}{' '}
          away.
        </Alert>
      )}
      {endError && !nearest && <Alert severity="error">{endError.message}</Alert>}

      <Button
        variant="contained"
        color="success"
        size="large"
        disabled={end.isPending || sim.running}
        onClick={() => end.mutate()}
      >
        {end.isPending ? 'Checking your return…' : 'End ride here'}
      </Button>
      <Typography variant="caption" color="text.secondary">
        A ride ends only at a rental station with a free dock. The vehicle's position is checked
        before it is made available to the next rider.
      </Typography>
    </Paper>
  );
}
