import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Chip, Paper, Typography } from '@mui/material';
import type { EcoSummaryDto, RentalDto } from '@mm/shared-types';
import { api } from '../../lib/api.ts';
import type { ApiClientError } from '../../lib/api.ts';
import { formatDistance, formatDuration, formatMoney } from '../../lib/money.ts';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews.tsx';
import { ReceiptDialog } from './ReceiptDialog.tsx';

const TYPE_LABEL: Record<string, string> = {
  scooter: 'E-scooter',
  ebike: 'E-bike',
  bike: 'Bike',
  ev: 'Micro-EV',
};

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Paper elevation={0} className="flex flex-col gap-0.5 p-3 shadow-card">
      <Typography variant="overline" color="text.secondary" className="leading-none">
        {label}
      </Typography>
      <Typography variant="h3" className="mono" sx={{ fontSize: 22 }}>
        {value}
      </Typography>
      {sub && (
        <Typography variant="caption" color="text.secondary">
          {sub}
        </Typography>
      )}
    </Paper>
  );
}

function EcoSummary({ eco }: { eco: EcoSummaryDto }) {
  // A tree absorbs roughly 21 kg of CO2 a year — a figure riders can picture.
  const treeDays = Math.round((eco.co2SavedKg / 21) * 365);
  return (
    <Box className="flex flex-col gap-2">
      <Typography variant="overline" color="text.secondary">
        Your eco-travel summary
      </Typography>
      <Box className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Tile
          label="CO₂ saved"
          value={`${eco.co2SavedKg.toFixed(1)} kg`}
          sub={treeDays > 0 ? `≈ ${treeDays} tree-days of absorption` : undefined}
        />
        <Tile
          label="Distance"
          value={`${eco.distanceKm.toFixed(1)} km`}
          sub={`${eco.trips} trips`}
        />
        <Tile label="Energy used" value={`${eco.energyKwh.toFixed(2)} kWh`} />
        <Tile
          label="Time riding"
          value={eco.rideMinutes < 1 ? 'Under 1 min' : formatDuration(eco.rideMinutes * 60)}
        />
        <Tile label="Spent" value={formatMoney(eco.spentMinor, eco.currency)} />
        <Tile
          label="Favourite"
          value={
            eco.byType.length > 0
              ? (TYPE_LABEL[[...eco.byType].sort((a, b) => b.trips - a.trips)[0]!.type] ?? '—')
              : '—'
          }
        />
      </Box>
      <Typography variant="caption" color="text.secondary">
        {eco.counterfactual}
      </Typography>
    </Box>
  );
}

export function TripsScreen() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const receiptId = params.get('receipt');

  const eco = useQuery({
    queryKey: ['rentals', 'eco-summary'],
    queryFn: () => api.get<EcoSummaryDto>('/rentals/eco-summary'),
  });
  const trips = useQuery({
    queryKey: ['rentals', 'list'],
    queryFn: () => api.get<RentalDto[]>('/rentals?limit=100'),
  });

  function openReceipt(id: string | null) {
    const next = new URLSearchParams(params);
    if (id) next.set('receipt', id);
    else next.delete('receipt');
    setParams(next, { replace: true });
  }

  const list = trips.data?.data ?? [];

  return (
    <Box className="mx-auto flex max-w-4xl flex-col gap-5 p-4 md:p-6">
      <Box>
        <Typography variant="overline" color="text.secondary">
          Trips
        </Typography>
        <Typography variant="h2" sx={{ fontSize: 26 }}>
          Your journeys
        </Typography>
      </Box>

      {eco.isLoading && <LoadingState rows={2} />}
      {eco.error && (
        <ErrorState error={eco.error as ApiClientError} onRetry={() => void eco.refetch()} />
      )}
      {eco.data && eco.data.data.trips > 0 && <EcoSummary eco={eco.data.data} />}

      <Box className="flex flex-col gap-2">
        <Typography variant="overline" color="text.secondary">
          Past journeys
        </Typography>
        {trips.isLoading && <LoadingState rows={4} />}
        {trips.error && (
          <ErrorState error={trips.error as ApiClientError} onRetry={() => void trips.refetch()} />
        )}
        {trips.data && list.length === 0 && (
          <EmptyState
            title="No journeys yet"
            action="Rent a vehicle from a station near you. Every ride you finish appears here with its receipt."
            actionLabel="Find a vehicle"
            onAction={() => navigate('/ride')}
          />
        )}
        {list.map((t) => (
          <Paper
            key={t.id}
            elevation={0}
            className="flex cursor-pointer flex-col gap-1 p-3 shadow-card hover:bg-ink-800 sm:flex-row sm:items-center sm:gap-4"
            onClick={() => (t.status === 'completed' ? openReceipt(t.id) : navigate('/ride'))}
          >
            <Box className="min-w-0 flex-1">
              <Typography variant="body2" className="truncate">
                {t.startStation?.name ?? 'Street pickup'} →{' '}
                {t.endStation?.name ?? (t.status === 'active' ? 'riding now' : 'street drop-off')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {new Date(t.startedAt).toLocaleString()} ·{' '}
                {TYPE_LABEL[t.vehicle.type] ?? t.vehicle.type} {t.vehicle.externalRef}
              </Typography>
            </Box>
            <Typography variant="body2" className="mono whitespace-nowrap" color="text.secondary">
              {formatDistance(t.distanceM)} · {formatDuration(t.durationS)}
            </Typography>
            <Box className="flex items-center gap-2">
              <Typography variant="body2" className="mono">
                {t.fare ? formatMoney(t.fare.totalMinor, t.fare.currency) : '—'}
              </Typography>
              {t.status === 'active' ? (
                <Chip size="small" color="success" label="Active" />
              ) : t.payment ? (
                <Chip
                  size="small"
                  variant="outlined"
                  color={t.payment.status === 'succeeded' ? 'success' : 'warning'}
                  label={t.payment.status === 'succeeded' ? 'Paid' : 'Payment due'}
                />
              ) : null}
            </Box>
          </Paper>
        ))}
      </Box>

      <ReceiptDialog rentalId={receiptId} onClose={() => openReceipt(null)} />
    </Box>
  );
}
