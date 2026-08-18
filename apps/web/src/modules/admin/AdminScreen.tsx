import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Button, MenuItem, Paper, TextField, Tooltip, Typography } from '@mui/material';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../lib/api.ts';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews.tsx';
import { authSnapshot } from '../../lib/auth-store.ts';

/**
 * M11 analytics + M10 environmental.
 *
 * Everything here reads the nightly rollup tables. Nothing aggregates raw trips
 * at request time, which is why a 30-day dashboard over 73k trips renders
 * without a spinner.
 */

interface SeriesPoint {
  day: string;
  trips: number;
  distanceKm: number;
  activeVehicles: number;
  tripsPerVehicle: number;
  meanTripKm: number;
  meanTripMin: number;
  energyKwh: number;
  co2eAvoidedKg: number;
}

interface ZoneRow {
  zoneId: string;
  name: string;
  tripsStarted: number;
  tripsEnded: number;
  netFlow: number;
  distanceKm: number;
  co2eAvoidedKg: number;
}

interface SummaryDto {
  range: { from: string; to: string; days: number };
  totals: {
    trips: number;
    distanceKm: number;
    durationHours: number;
    energyKwh: number;
    co2eAvoidedKg: number;
    tripsPerDay: number;
  };
  modalSplit: Record<string, number>;
  zones: ZoneRow[];
}

interface EnvironmentDto {
  co2eAvoidedKg: number;
  energyKwh: number;
  distanceKm: number;
  gPerKmSaved: number;
  counterfactual: string;
  factors: { mode: string; gCo2ePerKm: number; whPerKm: number; source: string }[];
}

const RANGES = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 14 days', days: 14 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 45 days', days: 45 },
];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

function Stat({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
}) {
  const tile = (
    <Box className="flex flex-col rounded-md border border-ink-700 p-3">
      <Typography variant="overline" color="text.secondary" className="leading-none">
        {label}
      </Typography>
      <Typography variant="h3" className="mono leading-tight" sx={{ fontSize: 24 }}>
        {value}
        {unit && (
          <Typography component="span" variant="caption" color="text.secondary" className="ml-1">
            {unit}
          </Typography>
        )}
      </Typography>
    </Box>
  );
  return hint ? <Tooltip title={hint}>{tile}</Tooltip> : tile;
}

export function AdminScreen() {
  const [days, setDays] = useState(30);
  const from = useMemo(() => isoDaysAgo(days), [days]);
  const to = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const range = `from=${from}&to=${to}`;

  const summary = useQuery({
    queryKey: ['analytics', 'summary', from, to],
    queryFn: () => api.get<SummaryDto>(`/analytics/summary?${range}`),
  });

  const series = useQuery({
    queryKey: ['analytics', 'timeseries', from, to],
    queryFn: () => api.get<SeriesPoint[]>(`/analytics/timeseries?${range}`),
  });

  const environment = useQuery({
    queryKey: ['analytics', 'environment', from, to],
    queryFn: () => api.get<EnvironmentDto>(`/analytics/environment?${range}`),
  });

  /**
   * The export is a download, so it cannot go through the JSON api client —
   * it needs the browser to receive text/csv with the Content-Disposition
   * intact. Fetching with the bearer token and handing back an object URL is
   * what preserves both.
   */
  async function downloadCsv() {
    const token = authSnapshot().accessToken;
    const res = await fetch(`/api/v1/analytics/export?${range}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kpi-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (summary.isError) {
    return <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />;
  }
  if (summary.isLoading) return <LoadingState />;

  const s = summary.data!.data;
  const points = series.data?.data ?? [];
  const env = environment.data?.data ?? null;

  if (s.range.days === 0) {
    return (
      <Box className="p-6">
        <EmptyState
          title="No rollups yet"
          action="The dashboard reads nightly rollup tables, and none have been built. Run `npm run rollup` to backfill from the seeded trip history."
        />
      </Box>
    );
  }

  const modal = Object.entries(s.modalSplit).sort((a, b) => b[1] - a[1]);
  const worstFlow = Math.max(1, ...s.zones.map((z) => Math.abs(z.netFlow)));

  return (
    <Box className="flex flex-col gap-4 p-6">
      <Box className="flex flex-wrap items-end justify-between gap-4">
        <Box>
          <Typography variant="overline" color="text.secondary">
            Admin
          </Typography>
          <Typography variant="h2" sx={{ fontSize: 30 }}>
            City analytics
          </Typography>
        </Box>

        <Box className="flex flex-wrap items-center gap-3">
          <TextField
            select
            size="small"
            label="Range"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            sx={{ minWidth: 160 }}
          >
            {RANGES.map((r) => (
              <MenuItem key={r.days} value={r.days}>
                {r.label}
              </MenuItem>
            ))}
          </TextField>
          <Button variant="outlined" onClick={() => void downloadCsv()}>
            Export CSV
          </Button>
        </Box>
      </Box>

      <Typography variant="caption" color="text.secondary">
        {s.range.from} to {s.range.to} · {s.range.days} days · read from nightly rollups, never
        aggregated from raw trips at request time
      </Typography>

      <Box className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Trips" value={s.totals.trips.toLocaleString()} />
        <Stat label="Per day" value={s.totals.tripsPerDay.toLocaleString()} />
        <Stat label="Distance" value={Math.round(s.totals.distanceKm).toLocaleString()} unit="km" />
        <Stat label="Ride time" value={Math.round(s.totals.durationHours).toLocaleString()} unit="h" />
        <Stat label="Energy" value={Math.round(s.totals.energyKwh).toLocaleString()} unit="kWh" />
        <Stat
          label="CO₂ avoided"
          value={Math.round(s.totals.co2eAvoidedKg).toLocaleString()}
          unit="kg"
          hint={env?.counterfactual}
        />
      </Box>

      <Paper elevation={0} className="flex flex-col gap-2 p-4 shadow-card">
        <Typography variant="overline" color="text.secondary">
          Trips per day
        </Typography>
        {series.isLoading ? (
          <LoadingState rows={3} />
        ) : points.length === 0 ? (
          <EmptyState title="No data in range" action="Widen the range, or run `npm run rollup`." />
        ) : (
          <Box className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="var(--ink-700)" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fill: 'var(--mist-400)', fontSize: 11 }}
                  tickFormatter={(d: string) => d.slice(5)}
                  stroke="var(--ink-700)"
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis tick={{ fill: 'var(--mist-400)', fontSize: 11 }} stroke="var(--ink-700)" />
                <ChartTooltip
                  contentStyle={{
                    background: 'var(--ink-900)',
                    border: '1px solid var(--ink-700)',
                    borderRadius: 8,
                    color: 'var(--mist-100)',
                  }}
                />
                {/* One series, so the title names it and no legend box is needed. */}
                <Line
                  type="monotone"
                  dataKey="trips"
                  name="Trips"
                  stroke="var(--series-1)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        )}
      </Paper>

      <Box className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Paper elevation={0} className="flex flex-col gap-3 p-4 shadow-card">
          <Typography variant="overline" color="text.secondary">
            Where vehicles accumulate
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Trips ended minus trips started. A zone that is persistently positive fills up
            overnight; a negative one is stripped by morning. This is the imbalance the
            rebalancing planner acts on.
          </Typography>

          <Box className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={s.zones.map((z) => ({ name: z.name, net: z.netFlow }))}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 4, left: 24 }}
              >
                <CartesianGrid stroke="var(--ink-700)" horizontal={false} />
                <XAxis
                  type="number"
                  domain={[-worstFlow, worstFlow]}
                  tick={{ fill: 'var(--mist-400)', fontSize: 11 }}
                  stroke="var(--ink-700)"
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={92}
                  tick={{ fill: 'var(--mist-400)', fontSize: 11 }}
                  stroke="var(--ink-700)"
                />
                <ChartTooltip
                  contentStyle={{
                    background: 'var(--ink-900)',
                    border: '1px solid var(--ink-700)',
                    borderRadius: 8,
                    color: 'var(--mist-100)',
                  }}
                />
                <Bar dataKey="net" name="Net flow" fill="var(--series-1)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Paper>

        <Paper elevation={0} className="flex flex-col gap-3 p-4 shadow-card">
          <Typography variant="overline" color="text.secondary">
            Modal split
          </Typography>
          <Box className="flex flex-col gap-2">
            {modal.map(([mode, share]) => (
              <Box key={mode} className="flex items-center gap-3">
                <Typography variant="body2" className="w-20 shrink-0 capitalize">
                  {mode}
                </Typography>
                <Box className="h-3 flex-1 overflow-hidden rounded-sm" sx={{ background: 'var(--ink-800)' }}>
                  <Box
                    className="h-full rounded-sm"
                    sx={{ width: `${share * 100}%`, background: 'var(--series-1)' }}
                  />
                </Box>
                <Typography variant="body2" className="mono w-14 shrink-0 text-right">
                  {(share * 100).toFixed(1)}%
                </Typography>
              </Box>
            ))}
          </Box>

          {env && (
            <>
              <Typography variant="overline" color="text.secondary" className="mt-3">
                Emission factors
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {env.counterfactual} Saving averages {env.gPerKmSaved} g/km across the fleet.
              </Typography>
              <Box className="flex flex-col gap-1">
                {env.factors.map((f) => (
                  <Tooltip key={f.mode} title={f.source}>
                    <Typography variant="caption" color="text.secondary" className="mono">
                      {f.mode.padEnd(9)} {String(f.gCo2ePerKm).padStart(7)} g/km ·{' '}
                      {String(f.whPerKm).padStart(6)} Wh/km
                    </Typography>
                  </Tooltip>
                ))}
              </Box>
            </>
          )}
        </Paper>
      </Box>

      <Paper elevation={0} className="flex flex-col gap-2 p-4 shadow-card">
        <Typography variant="overline" color="text.secondary">
          Per zone
        </Typography>
        <Box className="overflow-x-auto">
          <Box className="min-w-[560px]">
            <Box className="grid grid-cols-[1.4fr_repeat(5,1fr)] gap-2 border-b border-ink-700 pb-1">
              {['Zone', 'Started', 'Ended', 'Net', 'Distance km', 'CO₂ kg'].map((h) => (
                <Typography key={h} variant="caption" color="text.secondary">
                  {h}
                </Typography>
              ))}
            </Box>
            {s.zones.map((z) => (
              <Box
                key={z.zoneId}
                className="grid grid-cols-[1.4fr_repeat(5,1fr)] gap-2 border-b border-ink-800 py-1.5"
              >
                <Typography variant="body2">{z.name}</Typography>
                <Typography variant="body2" className="mono">{z.tripsStarted.toLocaleString()}</Typography>
                <Typography variant="body2" className="mono">{z.tripsEnded.toLocaleString()}</Typography>
                <Typography
                  variant="body2"
                  className="mono"
                  sx={{ color: z.netFlow > 0 ? 'var(--ok)' : z.netFlow < 0 ? 'var(--danger)' : 'var(--mist-400)' }}
                >
                  {z.netFlow > 0 ? '+' : ''}
                  {z.netFlow.toLocaleString()}
                </Typography>
                <Typography variant="body2" className="mono">{Math.round(z.distanceKm).toLocaleString()}</Typography>
                <Typography variant="body2" className="mono">{Math.round(z.co2eAvoidedKg).toLocaleString()}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}
