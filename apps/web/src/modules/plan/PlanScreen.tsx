import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { VEHICLE_TYPES } from '@mm/shared-types';
import type { LngLat, RouteCompareDto, RouteDto, VehicleType, ZoneDto } from '@mm/shared-types';
import { api } from '../../lib/api.ts';
import type { ApiClientError } from '../../lib/api.ts';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews.tsx';
import { RouteMap } from './RouteMap.tsx';
import type { ChargingStation, NearbyVehicle } from './RouteMap.tsx';

const PROFILE_BLURB: Record<string, string> = {
  fastest: 'Minimises time. Tolerates busy roads and hills.',
  safest: 'Prefers lit streets, bike lanes and quieter roads.',
  greenest: 'Avoids climbing and heavy traffic to save energy.',
};

function metres(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

/** A pin's coordinates, or a prompt when it has not been placed. */
function PinRow({
  label,
  point,
  colour,
  active,
  onFocus,
  onClear,
}: {
  label: string;
  point: LngLat | null;
  colour: string;
  active: boolean;
  onFocus: () => void;
  onClear: () => void;
}) {
  return (
    <Box
      className="flex items-center gap-3 rounded-md border px-3 py-2"
      sx={{
        borderColor: active ? colour : 'var(--ink-700)',
        background: active ? 'var(--ink-800)' : 'transparent',
      }}
    >
      <Box
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
        sx={{ background: colour, color: '#fff' }}
      >
        {label}
      </Box>
      <Box className="min-w-0 flex-1">
        <Typography variant="caption" color="text.secondary" className="block leading-none">
          {label === 'A' ? 'Pickup' : 'Destination'}
        </Typography>
        <Typography variant="body2" className="mono truncate">
          {point ? `${point[1].toFixed(5)}, ${point[0].toFixed(5)}` : 'not set — click the map'}
        </Typography>
      </Box>
      {point ? (
        <Button size="small" variant="text" color="inherit" onClick={onClear}>
          Clear
        </Button>
      ) : (
        <Button size="small" variant="text" onClick={onFocus} disabled={active}>
          Set
        </Button>
      )}
    </Box>
  );
}

function Metric({ label, value, unit, best }: { label: string; value: number; unit: string; best: boolean }) {
  return (
    <Box className="flex flex-col">
      <Typography variant="overline" color="text.secondary" className="leading-none">
        {label}
      </Typography>
      <Typography
        variant="h3"
        className="mono leading-tight"
        sx={{ fontSize: 19, color: best ? 'var(--ok)' : 'var(--mist-100)' }}
      >
        {value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
        <Typography component="span" variant="caption" color="text.secondary" className="ml-1">
          {unit}
        </Typography>
      </Typography>
    </Box>
  );
}

export function PlanScreen() {
  const [pickup, setPickup] = useState<LngLat | null>(null);
  const [drop, setDrop] = useState<LngLat | null>(null);
  const [picking, setPicking] = useState<'pickup' | 'drop'>('pickup');
  const [mode, setMode] = useState<VehicleType>('scooter');
  const [profile, setProfile] = useState('fastest');
  const [geoError, setGeoError] = useState<string | null>(null);

  const zones = useQuery({
    queryKey: ['geo', 'zones'],
    queryFn: () => api.get<ZoneDto[]>('/geo/zones'),
    staleTime: 60 * 60 * 1000,
  });

  /** Vehicles a rider standing at the pickup pin could actually walk to. */
  const vehicles = useQuery({
    queryKey: ['charging', 'vehicles-near', pickup],
    queryFn: () =>
      api.get<NearbyVehicle[]>(
        `/charging/vehicles/near?lng=${pickup![0]}&lat=${pickup![1]}&radiusM=1200`,
      ),
    enabled: pickup !== null,
  });

  const routes = useMutation({
    mutationFn: () =>
      api.post<RouteCompareDto>('/routes/compare', {
        origin: pickup,
        destination: drop,
        mode,
      }),
  });

  const routeList = routes.data?.data.routes ?? [];
  const selected = routeList.find((r) => r.profile === profile) ?? routeList[0] ?? null;

  /**
   * Charging stations along the chosen route.
   *
   * Keyed on the selected route so switching profile re-asks: the safest route
   * may pass different infrastructure than the fastest, and showing the
   * fastest route's stations beside the safest route's line would be wrong in
   * exactly the way nobody would notice.
   */
  const stations = useMutation({
    mutationFn: (path: LngLat[]) =>
      api.post<ChargingStation[]>('/charging/stations/along-route', { path, corridorM: 700 }),
  });

  useEffect(() => {
    if (!selected) return;
    stations.mutate(selected.geometry.coordinates as LngLat[]);
    // Keyed on the route's identity, not the mutation object: including
    // `stations` would re-run on every mutation state change and loop.
  }, [selected?.profile, selected?.distanceM]);

  // Plan as soon as both pins exist — a rider should not have to find a button.
  useEffect(() => {
    if (pickup && drop) routes.mutate();
    // Same reasoning: the inputs are the pins and the mode, not the mutation.
  }, [pickup, drop, mode]);

  function handlePick(point: LngLat) {
    if (picking === 'pickup') {
      setPickup(point);
      setPicking('drop');
    } else {
      setDrop(point);
      setPicking('pickup');
    }
  }

  function useMyLocation() {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError('This browser has no location support. Click the map instead.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPickup([Number(pos.coords.longitude.toFixed(6)), Number(pos.coords.latitude.toFixed(6))]);
        setPicking('drop');
      },
      // Browsers refuse geolocation on insecure origins and when the user
      // declines. Both are normal; say what to do instead of failing silently.
      () =>
        setGeoError(
          'Location unavailable — permission denied, or the page is not on HTTPS. Click the map to set your pickup.',
        ),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  /** Drops both pins on two zone centres, for a demo without hunting the map. */
  function useSampleTrip() {
    const list = zones.data?.data ?? [];
    if (list.length < 2) return;
    setPickup(list[0]!.centroid.coordinates);
    setDrop(list[Math.min(3, list.length - 1)]!.centroid.coordinates);
    setPicking('pickup');
  }

  const bests = useMemo(() => {
    if (routeList.length === 0) return { eta: 0, distance: 0, risk: 0, energy: 0 };
    return {
      eta: Math.min(...routeList.map((r) => r.etaMinutes)),
      distance: Math.min(...routeList.map((r) => r.distanceM)),
      risk: Math.min(...routeList.map((r) => r.riskScore)),
      energy: Math.min(...routeList.map((r) => r.energyWh)),
    };
  }, [routeList]);

  const nearby = vehicles.data?.data ?? [];
  const stationList = stations.data?.data ?? [];
  const routeError = routes.error as ApiClientError | null;

  return (
    <Box className="flex h-[calc(100vh-var(--topbar-h))] flex-col lg:flex-row">
      {/* ---- controls ---- */}
      <Box className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-ink-700 p-4 lg:w-[400px] lg:border-r">
        <Box>
          <Typography variant="overline" color="text.secondary">
            Plan
          </Typography>
          <Typography variant="h2" sx={{ fontSize: 26 }}>
            Where to?
          </Typography>
        </Box>

        <PinRow
          label="A"
          point={pickup}
          colour="var(--series-1)"
          active={picking === 'pickup'}
          onFocus={() => setPicking('pickup')}
          onClear={() => {
            setPickup(null);
            setPicking('pickup');
            routes.reset();
          }}
        />
        <PinRow
          label="B"
          point={drop}
          colour="var(--series-2)"
          active={picking === 'drop'}
          onFocus={() => setPicking('drop')}
          onClear={() => {
            setDrop(null);
            setPicking('drop');
            routes.reset();
          }}
        />

        <Box className="flex flex-wrap gap-2">
          <Button size="small" variant="outlined" onClick={useMyLocation}>
            Use my location
          </Button>
          <Button size="small" variant="text" onClick={useSampleTrip}>
            Sample trip
          </Button>
        </Box>

        {geoError && (
          <Typography variant="caption" sx={{ color: 'var(--warn)' }}>
            {geoError}
          </Typography>
        )}

        <TextField
          select
          size="small"
          label="Vehicle"
          value={mode}
          onChange={(e) => setMode(e.target.value as VehicleType)}
        >
          {VEHICLE_TYPES.map((t) => (
            <MenuItem key={t} value={t}>
              {t}
            </MenuItem>
          ))}
        </TextField>

        {routes.isPending && <LoadingState rows={3} />}

        {routeError && (
          <ErrorState error={routeError} onRetry={() => routes.mutate()} />
        )}

        {!pickup && !routes.isPending && (
          <EmptyState
            title="Pick two points"
            action="Click the map for your pickup, then your destination. Or press Sample trip."
          />
        )}

        {/* ---- route options ---- */}
        {routeList.length > 0 && (
          <Box className="flex flex-col gap-2">
            <Typography variant="overline" color="text.secondary">
              {routeList.length} routes
            </Typography>

            {routeList.map((r: RouteDto) => {
              const active = r.profile === profile;
              return (
                <Paper
                  key={r.profile}
                  elevation={0}
                  onClick={() => setProfile(r.profile)}
                  className="cursor-pointer p-3 shadow-card"
                  sx={{
                    borderLeft: '3px solid',
                    borderLeftColor: active ? 'var(--series-1)' : 'transparent',
                    background: active ? 'var(--ink-800)' : undefined,
                  }}
                >
                  <Box className="flex items-baseline justify-between gap-2">
                    <Typography variant="h3" sx={{ fontSize: 16, textTransform: 'capitalize' }}>
                      {r.profile}
                    </Typography>
                    <Typography variant="body2" className="mono">
                      {r.etaMinutes.toFixed(0)} min · {metres(r.distanceM)}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" className="mt-0.5 block">
                    {PROFILE_BLURB[r.profile]}
                  </Typography>

                  {active && (
                    <Box className="mt-3 grid grid-cols-4 gap-2">
                      <Metric label="ETA" value={r.etaMinutes} unit="min" best={r.etaMinutes === bests.eta} />
                      <Metric label="Distance" value={r.distanceM / 1000} unit="km" best={r.distanceM === bests.distance} />
                      <Metric label="Risk" value={r.riskScore} unit="/100" best={r.riskScore === bests.risk} />
                      <Metric label="Energy" value={r.energyWh} unit="Wh" best={r.energyWh === bests.energy} />
                    </Box>
                  )}
                </Paper>
              );
            })}

            {selected && selected.snapDistanceM > 0 && (
              <Typography variant="caption" color="text.secondary">
                Your pins were snapped up to {Math.round(selected.snapDistanceM)} m to the nearest
                road — routes must start and end on the network.
              </Typography>
            )}
          </Box>
        )}

        {/* ---- vehicles nearby ---- */}
        {pickup && (
          <Box className="flex flex-col gap-2">
            <Typography variant="overline" color="text.secondary">
              Available near your pickup
            </Typography>

            {vehicles.isLoading ? (
              <LoadingState rows={2} />
            ) : nearby.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Nothing available within 1.2 km. Try a pickup closer to the centre.
              </Typography>
            ) : (
              nearby.slice(0, 6).map((v) => {
                const flat = v.batteryPct !== null && v.batteryPct < 20;
                return (
                  <Box
                    key={v.id}
                    className="flex items-center gap-3 rounded-md border border-ink-700 px-3 py-2"
                  >
                    <Box
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      sx={{ background: `var(--line-${v.type})` }}
                    />
                    <Box className="min-w-0 flex-1">
                      <Typography variant="body2" className="truncate">
                        {v.externalRef}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {v.type} · {v.distanceM} m walk
                      </Typography>
                    </Box>
                    <Tooltip
                      title={
                        v.rangeM > 0
                          ? `About ${(v.rangeM / 1000).toFixed(0)} km of range left`
                          : 'Pedal powered — no battery'
                      }
                    >
                      <Typography
                        variant="body2"
                        className="mono"
                        sx={{ color: flat ? 'var(--danger)' : 'var(--mist-100)' }}
                      >
                        {v.batteryPct === null ? '—' : `${Math.round(v.batteryPct)}%`}
                      </Typography>
                    </Tooltip>
                  </Box>
                );
              })
            )}
          </Box>
        )}

        {/* ---- charging on the way ---- */}
        {selected && (
          <Box className="flex flex-col gap-2">
            <Typography variant="overline" color="text.secondary">
              Charging on the way
            </Typography>
            {stations.isPending ? (
              <LoadingState rows={2} />
            ) : stationList.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No charging point within 700 m of this route. A planner can add one from the Admin
                screen.
              </Typography>
            ) : (
              stationList.map((s) => (
                <Box
                  key={s.id}
                  className="flex items-center gap-3 rounded-md border border-ink-700 px-3 py-2"
                >
                  <Box
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs"
                    sx={{ background: 'var(--warn)', color: '#0b1220' }}
                  >
                    ⚡
                  </Box>
                  <Box className="min-w-0 flex-1">
                    <Typography variant="body2" className="truncate">
                      {s.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {s.connectors} points · {s.powerKw} kW
                    </Typography>
                  </Box>
                  <Chip size="small" variant="outlined" label={`${s.distanceM ?? 0} m`} />
                </Box>
              ))
            )}
          </Box>
        )}
      </Box>

      {/* ---- map ---- */}
      <Box className="min-h-[420px] flex-1">
        <RouteMap
          pickup={pickup}
          drop={drop}
          picking={picking}
          routes={routeList}
          selectedProfile={selected?.profile ?? profile}
          vehicles={nearby}
          stations={stationList}
          onPick={handlePick}
        />
      </Box>
    </Box>
  );
}
