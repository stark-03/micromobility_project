import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Chip, Paper, Typography } from '@mui/material';
import type {
  LngLat,
  PlaceDto,
  RecommendationResponseDto,
  RentalDto,
  RentalStationDto,
} from '@mm/shared-types';
import { api } from '../../lib/api.ts';
import type { ApiClientError } from '../../lib/api.ts';
import { formatDistance, formatDuration, formatMoney } from '../../lib/money.ts';
import { PlaceSearch } from '../../components/PlaceSearch.tsx';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews.tsx';
import { ActiveRide, currentPosition } from './ActiveRide.tsx';
import { ACTIVE_RENTAL_KEY } from './gps.ts';
import { RideMap } from './RideMap.tsx';
import type { ChargerPin } from './RideMap.tsx';
import { Recommendations, StationCard } from './StationCard.tsx';
import { UnlockDialog } from './UnlockDialog.tsx';

/** How far a rider will walk to a station. Matches the recommender's radius. */
const STATION_RADIUS_M = 1500;
const CHARGER_RADIUS_M = 2500;

function parseLngLat(v: string | null): LngLat | null {
  if (!v) return null;
  const [lng, lat] = v.split(',').map(Number);
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng!, lat!] : null;
}

/** The summary shown the moment a ride ends: what it cost and what it saved. */
function RideComplete({ rental, onDone }: { rental: RentalDto; onDone: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pay = useMutation({
    mutationFn: () => api.post<RentalDto>(`/rentals/${rental.id}/pay`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['rentals'] }),
  });
  const payment = pay.data?.data.payment ?? rental.payment;

  return (
    <Paper
      elevation={0}
      className="flex flex-col gap-3 p-4 shadow-card"
      sx={{ borderTop: '3px solid var(--series-1)' }}
    >
      <Typography variant="overline" color="text.secondary">
        Ride complete
      </Typography>
      <Typography variant="h3" sx={{ fontSize: 22 }}>
        {rental.fare ? formatMoney(rental.fare.totalMinor) : '—'}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {formatDistance(rental.distanceM)} in {formatDuration(rental.durationS)} ·{' '}
        {rental.startStation?.name ?? 'start'} → {rental.endStation?.name ?? 'end'}
      </Typography>
      {rental.co2SavedG !== null && rental.co2SavedG > 0 && (
        <Typography variant="body2" sx={{ color: 'var(--ok)' }}>
          About {Math.round(rental.co2SavedG)} g of CO₂ saved compared with making this trip by car.
        </Typography>
      )}
      {payment?.status === 'succeeded' && (
        <Chip
          size="small"
          color="success"
          label={`Paid · ${payment.providerRef}`}
          className="self-start"
        />
      )}
      {payment?.status === 'failed' && (
        <Alert
          severity="warning"
          action={
            <Button
              color="inherit"
              size="small"
              disabled={pay.isPending}
              onClick={() => pay.mutate()}
            >
              Retry
            </Button>
          }
        >
          Payment did not go through. Your ride is ended and the vehicle returned; retry when ready.
        </Alert>
      )}
      <Box className="flex gap-2">
        <Button variant="outlined" onClick={() => navigate(`/trips?receipt=${rental.id}`)}>
          View receipt
        </Button>
        <Button variant="text" onClick={onDone}>
          Done
        </Button>
      </Box>
    </Paper>
  );
}

export function RideScreen() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const [origin, setOrigin] = useState<LngLat | null>(() => parseLngLat(params.get('from')));
  const [originLabel, setOriginLabel] = useState<string | null>(null);
  const [destination, setDestination] = useState<LngLat | null>(() =>
    parseLngLat(params.get('to')),
  );
  const [destLabel, setDestLabel] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [unlockCode, setUnlockCode] = useState<string | null>(params.get('unlock'));
  const [unlockOpen, setUnlockOpen] = useState(params.get('unlock') !== null);
  const [plannedPath, setPlannedPath] = useState<LngLat[]>([]);
  const [ended, setEnded] = useState<RentalDto | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  const active = useQuery({
    queryKey: ACTIVE_RENTAL_KEY,
    queryFn: () => api.get<RentalDto | null>('/rentals/active'),
    // The fare runs with the clock; refresh it now and then even without GPS.
    refetchInterval: (q) => (q.state.data?.data ? 15_000 : false),
  });
  const rental = active.data?.data ?? null;
  const ridingAt = rental ? currentPosition(rental) : null;
  const where = ridingAt ?? origin;

  // While riding, `where` moves with every GPS fix. Keying the lookups on a
  // ~1 km grid then, rather than ~10 m, stops them refetching on every fix —
  // which, on top of the fixes themselves, would trip the API's rate limit.
  const grid = rental ? 2 : 4;
  const stations = useQuery({
    queryKey: ['stations', 'near', where?.[0].toFixed(grid), where?.[1].toFixed(grid)],
    queryFn: () =>
      api.get<RentalStationDto[]>(
        `/stations/near?lng=${where![0]}&lat=${where![1]}&radiusM=${STATION_RADIUS_M}`,
      ),
    enabled: where !== null,
  });

  const chargers = useQuery({
    queryKey: [
      'charging',
      'near',
      where?.[0].toFixed(Math.min(grid, 3)),
      where?.[1].toFixed(Math.min(grid, 3)),
    ],
    queryFn: () =>
      api.get<ChargerPin[]>(
        `/charging/stations/near?lng=${where![0]}&lat=${where![1]}&radiusM=${CHARGER_RADIUS_M}`,
      ),
    enabled: where !== null,
  });

  const recommend = useQuery({
    queryKey: ['rentals', 'recommend', origin, destination],
    queryFn: () =>
      api.post<RecommendationResponseDto>('/rentals/recommend', { origin, destination }),
    enabled: origin !== null && destination !== null && !rental,
  });

  // A QR sticker opens /ride?unlock=CODE; clear the param once it is consumed.
  useEffect(() => {
    if (params.get('unlock')) {
      const next = new URLSearchParams(params);
      next.delete('unlock');
      setParams(next, { replace: true });
    }
  }, []);

  function locateMe() {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError('This browser has no location support. Search for a place or click the map.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigin([
          Number(pos.coords.longitude.toFixed(6)),
          Number(pos.coords.latitude.toFixed(6)),
        ]);
        setOriginLabel('Your location');
      },
      () =>
        setGeoError(
          'Location unavailable — permission denied, or not on HTTPS. Search for a place or click the map.',
        ),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  function openUnlock(code: string | null) {
    setUnlockCode(code);
    setUnlockOpen(true);
  }

  const stationList = stations.data?.data ?? [];
  const chargerList = chargers.data?.data ?? [];
  const tripDistanceM = recommend.data?.data.tripDistanceM ?? null;

  const header = useMemo(
    () => (
      <Box>
        <Typography variant="overline" color="text.secondary">
          Ride
        </Typography>
        <Typography variant="h2" sx={{ fontSize: 26 }}>
          {rental ? 'On your way' : 'Rent a vehicle'}
        </Typography>
      </Box>
    ),
    [rental],
  );

  if (active.isLoading) return <LoadingState rows={4} />;
  if (active.error) {
    return (
      <ErrorState error={active.error as ApiClientError} onRetry={() => void active.refetch()} />
    );
  }

  return (
    <Box className="flex h-[calc(100vh-var(--topbar-h))] flex-col lg:flex-row">
      <Box className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-ink-700 p-4 lg:w-[420px] lg:border-r">
        {header}

        {rental ? (
          <ActiveRide
            rental={rental}
            destination={destination}
            onPlannedPath={setPlannedPath}
            onEnded={(r) => {
              setEnded(r);
              setOrigin(r.endPosition);
              setOriginLabel(r.endStation?.name ?? null);
              setDestination(null);
              setDestLabel(null);
            }}
          />
        ) : ended ? (
          <RideComplete rental={ended} onDone={() => setEnded(null)} />
        ) : (
          <>
            {/* ---- where am I, where am I going ---- */}
            <PlaceSearch
              label={originLabel ? `From: ${originLabel}` : 'Where are you?'}
              onSelect={(p: PlaceDto) => {
                setOrigin(p.location);
                setOriginLabel(p.name);
              }}
            />
            <PlaceSearch
              label={destLabel ? `To: ${destLabel}` : 'Where to? (for a recommendation)'}
              onSelect={(p: PlaceDto) => {
                setDestination(p.location);
                setDestLabel(p.name);
              }}
            />
            <Box className="flex flex-wrap gap-2">
              <Button size="small" variant="outlined" onClick={locateMe}>
                Use my location
              </Button>
              <Button size="small" variant="contained" onClick={() => openUnlock(null)}>
                Scan QR to unlock
              </Button>
              {destination && (
                <Button
                  size="small"
                  variant="text"
                  onClick={() => {
                    setDestination(null);
                    setDestLabel(null);
                  }}
                >
                  Clear destination
                </Button>
              )}
            </Box>
            {geoError && (
              <Typography variant="caption" sx={{ color: 'var(--warn)' }}>
                {geoError}
              </Typography>
            )}

            {!origin && (
              <EmptyState
                title="Find a vehicle near you"
                action="Use your location, search for a place, or click the map to see the rental stations around it."
              />
            )}

            {/* ---- recommendation ---- */}
            {recommend.isLoading && <LoadingState rows={2} />}
            {recommend.error && (
              <ErrorState
                error={recommend.error as ApiClientError}
                onRetry={() => void recommend.refetch()}
              />
            )}
            {recommend.data && (
              <Recommendations
                data={recommend.data.data}
                onUnlock={(code) => openUnlock(code)}
                onFocusStation={(id) => setExpanded(id)}
              />
            )}
            {origin && !destination && (
              <Typography variant="caption" color="text.secondary">
                Add a destination to get a vehicle recommended on time, cost, charge and
                availability — and a fare estimate before you unlock.
              </Typography>
            )}

            {/* ---- stations nearby ---- */}
            {origin && (
              <Box className="flex flex-col gap-2">
                <Typography variant="overline" color="text.secondary">
                  Rental stations within {formatDistance(STATION_RADIUS_M)}
                </Typography>
                {stations.isLoading && <LoadingState rows={2} />}
                {stations.error && (
                  <ErrorState
                    error={stations.error as ApiClientError}
                    onRetry={() => void stations.refetch()}
                  />
                )}
                {stations.data && stationList.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    No rental station within walking distance. Try a place nearer the city centre.
                  </Typography>
                )}
                {stationList.map((s) => (
                  <StationCard
                    key={s.id}
                    station={s}
                    expanded={expanded === s.id}
                    onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
                    onUnlock={(code) => openUnlock(code)}
                  />
                ))}
              </Box>
            )}

            {/* ---- charging nearby ---- */}
            {origin && chargerList.length > 0 && (
              <Box className="flex flex-col gap-1">
                <Typography variant="overline" color="text.secondary">
                  EV charging near you
                </Typography>
                {chargerList.slice(0, 4).map((c) => (
                  <Typography key={c.id} variant="body2">
                    ⚡ {c.name} · {c.connectors} points · {c.powerKw} kW
                    <Typography component="span" variant="caption" color="text.secondary">
                      {' '}
                      · {formatDistance(c.distanceM ?? 0)}
                    </Typography>
                  </Typography>
                ))}
              </Box>
            )}
          </>
        )}
      </Box>

      <Box className="min-h-[420px] flex-1">
        <RideMap
          origin={rental ? null : origin}
          destination={rental ? null : destination}
          stations={stationList}
          chargers={chargerList}
          selectedStationId={expanded}
          ridePath={rental?.path ?? []}
          vehicleAt={ridingAt}
          plannedPath={plannedPath}
          onPick={
            rental
              ? undefined
              : (p) => {
                  setOrigin(p);
                  setOriginLabel('Pinned on map');
                }
          }
          onSelectStation={(id) => setExpanded(id)}
        />
      </Box>

      <UnlockDialog
        open={unlockOpen}
        initialCode={unlockCode}
        tripDistanceM={tripDistanceM}
        onClose={() => setUnlockOpen(false)}
        onStarted={() => {
          setUnlockOpen(false);
          setEnded(null);
          void qc.invalidateQueries({ queryKey: ['stations'] });
        }}
      />
    </Box>
  );
}
