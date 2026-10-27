import { useQuery } from '@tanstack/react-query';
import { Box, Button, Chip, Collapse, Paper, Tooltip, Typography } from '@mui/material';
import type {
  RecommendationResponseDto,
  RentalStationDetailDto,
  RentalStationDto,
  StationVehicleDto,
  VehicleRecommendationDto,
} from '@mm/shared-types';
import { api } from '../../lib/api.ts';
import { formatDistance, formatDuration, formatMoney } from '../../lib/money.ts';
import { LoadingState } from '../../components/StateViews.tsx';

const TYPE_LABEL: Record<string, string> = {
  scooter: 'E-scooter',
  ebike: 'E-bike',
  bike: 'Bike',
  ev: 'Micro-EV',
};

function Dot({ type }: { type: string }) {
  return (
    <Box className="h-2.5 w-2.5 shrink-0 rounded-full" sx={{ background: `var(--line-${type})` }} />
  );
}

/** Battery %, capacity and range in one line — what a rider checks before walking over. */
export function BatteryLine({ v }: { v: StationVehicleDto }) {
  if (v.battery.pct === null) {
    return (
      <Typography variant="caption" color="text.secondary">
        Pedal powered — no battery
      </Typography>
    );
  }
  const low = v.battery.pct < 20;
  return (
    <Typography
      variant="caption"
      className="mono"
      sx={{ color: low ? 'var(--danger)' : 'var(--mist-400)' }}
    >
      {v.battery.pct}% of {v.battery.capacityWh} Wh · ~{formatDistance(v.battery.rangeM ?? 0)} range
    </Typography>
  );
}

function VehicleRow({ v, onUnlock }: { v: StationVehicleDto; onUnlock: (code: string) => void }) {
  return (
    <Box className="flex items-center gap-3 rounded-md border border-ink-700 px-3 py-2">
      <Dot type={v.type} />
      <Box className="min-w-0 flex-1">
        <Typography variant="body2" className="truncate">
          {TYPE_LABEL[v.type] ?? v.type} · {v.externalRef}
        </Typography>
        <BatteryLine v={v} />
      </Box>
      {v.rentable ? (
        <Button size="small" variant="outlined" onClick={() => onUnlock(v.unlockCode)}>
          Unlock
        </Button>
      ) : (
        <Chip
          size="small"
          variant="outlined"
          label={v.status === 'available' ? 'Low battery' : v.status.replace('_', ' ')}
        />
      )}
    </Box>
  );
}

export function StationCard({
  station,
  expanded,
  onToggle,
  onUnlock,
}: {
  station: RentalStationDto;
  expanded: boolean;
  onToggle: () => void;
  onUnlock: (code: string) => void;
}) {
  const detail = useQuery({
    queryKey: ['stations', 'detail', station.id],
    queryFn: () => api.get<RentalStationDetailDto>(`/stations/${station.id}`),
    enabled: expanded,
  });

  const empty = station.rentableTotal === 0;

  return (
    <Paper
      elevation={0}
      className="p-3 shadow-card"
      sx={{
        borderLeft: '3px solid',
        borderLeftColor: expanded ? 'var(--series-1)' : 'transparent',
      }}
    >
      <Box className="flex cursor-pointer items-start justify-between gap-2" onClick={onToggle}>
        <Box className="min-w-0">
          <Typography variant="h3" sx={{ fontSize: 16 }} className="truncate">
            {station.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {station.distanceM !== undefined ? `${formatDistance(station.distanceM)} away · ` : ''}
            {station.freeDocks} of {station.capacity} docks free
          </Typography>
        </Box>
        <Chip
          size="small"
          color={empty ? 'default' : 'success'}
          variant={empty ? 'outlined' : 'filled'}
          label={empty ? 'None to rent' : `${station.rentableTotal} to rent`}
        />
      </Box>

      {/* Count and type of vehicle at a glance. */}
      <Box className="mt-2 flex flex-wrap gap-1.5">
        {station.inventory
          .filter((i) => i.rentable + i.unavailable > 0)
          .map((i) => (
            <Tooltip
              key={i.type}
              title={`${i.rentable} ready to rent, ${i.unavailable} charging, in maintenance or too flat`}
            >
              <Box className="flex items-center gap-1.5 rounded-sm border border-ink-700 px-2 py-0.5">
                <Dot type={i.type} />
                <Typography variant="caption" className="mono">
                  {TYPE_LABEL[i.type]} {i.rentable}
                  {i.unavailable > 0 && (
                    <span style={{ color: 'var(--mist-400)' }}> +{i.unavailable}</span>
                  )}
                </Typography>
              </Box>
            </Tooltip>
          ))}
        {station.inventory.every((i) => i.rentable + i.unavailable === 0) && (
          <Typography variant="caption" color="text.secondary">
            No vehicles docked
          </Typography>
        )}
      </Box>

      <Collapse in={expanded} unmountOnExit>
        <Box className="mt-3 flex flex-col gap-2">
          {detail.isLoading && <LoadingState rows={2} />}
          {detail.data?.data.vehicles.map((v) => (
            <VehicleRow key={v.id} v={v} onUnlock={onUnlock} />
          ))}
          {detail.data && detail.data.data.vehicles.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Nothing docked here right now. Check the recommendations for the nearest alternative.
            </Typography>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}

export function Recommendations({
  data,
  onUnlock,
  onFocusStation,
}: {
  data: RecommendationResponseDto;
  onUnlock: (code: string) => void;
  onFocusStation: (id: string) => void;
}) {
  return (
    <Box className="flex flex-col gap-2">
      <Typography variant="overline" color="text.secondary">
        Recommended for your {formatDistance(data.tripDistanceM)} trip
        {data.distanceSource === 'estimate' ? ' (estimated — router offline)' : ''}
      </Typography>

      {data.nearestStationNote && (
        <Box className="rounded-md border px-3 py-2" sx={{ borderColor: 'var(--warn)' }}>
          <Typography variant="body2">{data.nearestStationNote}</Typography>
        </Box>
      )}

      {data.recommendations.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No vehicle within walking distance can make this trip right now. Try a pickup nearer the
          centre, or check again once vehicles have charged.
        </Typography>
      ) : (
        data.recommendations.map((r: VehicleRecommendationDto) => (
          <Paper
            key={`${r.station.id}-${r.vehicleType}`}
            elevation={0}
            className="p-3 shadow-card"
            sx={{
              borderLeft: '3px solid',
              borderLeftColor: r.rank === 1 ? 'var(--ok)' : 'transparent',
            }}
          >
            <Box className="flex items-baseline justify-between gap-2">
              <Typography variant="h3" sx={{ fontSize: 16 }}>
                {r.rank === 1 ? 'Best: ' : `${r.rank}. `}
                {TYPE_LABEL[r.vehicleType]}
              </Typography>
              <Typography variant="body2" className="mono">
                {formatMoney(r.fare.totalMinor)}
              </Typography>
            </Box>
            <Typography
              variant="caption"
              color="text.secondary"
              className="block cursor-pointer underline-offset-2 hover:underline"
              onClick={() => onFocusStation(r.station.id)}
            >
              {r.alternative ? 'Alternative: ' : ''}
              {r.station.name} · {formatDistance(r.walkM)} walk · {formatDuration(r.rideDurationS)}{' '}
              ride
            </Typography>
            <Box className="mt-1">
              <BatteryLine v={r.vehicle} />
            </Box>
            <Box className="mt-1.5 flex flex-wrap gap-1">
              {r.reasons.map((reason) => (
                <Chip key={reason} size="small" variant="outlined" label={reason} />
              ))}
            </Box>
            <Box className="mt-2 flex justify-end">
              <Button
                size="small"
                variant={r.rank === 1 ? 'contained' : 'outlined'}
                onClick={() => onUnlock(r.vehicle.unlockCode)}
              >
                Unlock {r.vehicle.externalRef}
              </Button>
            </Box>
          </Paper>
        ))
      )}
    </Box>
  );
}
