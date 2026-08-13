import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ZoneDto } from '@mm/shared-types';
import { api } from '../../lib/api.ts';
import type { ApiClientError } from '../../lib/api.ts';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews.tsx';
import { seriesColours, token } from '../../lib/tokens.ts';

interface Forecast {
  zoneId: string;
  slotStart: string;
  horizonMin: number;
  predictedTrips: number;
  p10: number;
  p90: number;
  modelVersion: string;
}

interface ModelRow {
  id: string;
  version: string;
  algorithm: string;
  train_rows: number;
  valid_rows: number;
  mae: string | null;
  rmse: string | null;
  mape: string | null;
  baseline_mae: string | null;
  skill_ratio: string | null;
  is_active: number;
  created_at: string;
}

/** A headline figure. Not a chart — one number needs no axes. */
function StatTile({
  label,
  value,
  unit,
  note,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  tone?: string;
}) {
  return (
    <Paper elevation={0} className="flex min-w-[150px] flex-1 flex-col gap-1 p-4">
      <Typography variant="overline" color="text.secondary" className="leading-none">
        {label}
      </Typography>
      <Typography
        variant="h2"
        className="mono leading-none"
        sx={{ fontSize: 30, color: tone ?? 'var(--mist-100)' }}
      >
        {value}
        {unit && (
          <Typography component="span" variant="caption" color="text.secondary" className="ml-1">
            {unit}
          </Typography>
        )}
      </Typography>
      {note && (
        <Typography variant="caption" color="text.secondary">
          {note}
        </Typography>
      )}
    </Paper>
  );
}

function ForecastTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: { predicted: number; p10: number; p90: number } }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  return (
    <Paper elevation={0} className="p-2">
      <Typography variant="caption" color="text.secondary" className="block">
        {label}
      </Typography>
      <Typography variant="body2" className="mono">
        {p.predicted.toFixed(2)} trips
      </Typography>
      <Typography variant="caption" color="text.secondary" className="mono">
        80% interval {p.p10.toFixed(2)} – {p.p90.toFixed(2)}
      </Typography>
    </Paper>
  );
}

export function DataScreen() {
  const [zoneId, setZoneId] = useState('');
  const queryClient = useQueryClient();
  const [seriesColour] = seriesColours();

  const zones = useQuery({
    queryKey: ['geo', 'zones'],
    queryFn: () => api.get<ZoneDto[]>('/geo/zones'),
    staleTime: 60 * 60 * 1000,
  });

  const models = useQuery({
    queryKey: ['predictions', 'models'],
    queryFn: () => api.get<ModelRow[]>('/predictions/models'),
  });

  const forecast = useQuery({
    queryKey: ['predictions', 'demand'],
    queryFn: () => api.get<Forecast[]>('/predictions/demand?horizon=12'),
    retry: false,
  });

  const train = useMutation({
    mutationFn: () => api.post<{ jobId: string }>('/predictions/train'),
    onSuccess: () => {
      // Training is a job; give it a moment, then refresh the registry.
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['predictions'] });
      }, 4000);
    },
  });

  const zoneList = zones.data?.data ?? [];
  const activeZone = zoneId || zoneList[0]?.id || '';

  const chartData = useMemo(() => {
    const rows = (forecast.data?.data ?? []).filter((f) => f.zoneId === activeZone);
    return rows.map((f) => ({
      at: new Date(f.slotStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      predicted: f.predictedTrips,
      p10: f.p10,
      p90: f.p90,
      // Recharts stacks an Area from a base; the band is [p10, p90-p10].
      band: [f.p10, f.p90] as [number, number],
    }));
  }, [forecast.data, activeZone]);

  const registry = models.data?.data ?? [];
  const active = registry.find((m) => Number(m.is_active) === 1);

  if (zones.isLoading || models.isLoading) return <LoadingState rows={6} />;
  if (zones.isError) {
    return <ErrorState error={zones.error as ApiClientError} onRetry={() => void zones.refetch()} />;
  }

  const skill = active?.skill_ratio ? Number(active.skill_ratio) : null;

  return (
    <Box className="flex flex-col gap-4 p-6">
      <Box className="flex flex-wrap items-end justify-between gap-3">
        <Box>
          <Typography variant="overline" color="text.secondary">
            Data
          </Typography>
          <Typography variant="h2" sx={{ fontSize: 30 }}>
            Demand forecasting
          </Typography>
        </Box>
        <Button variant="outlined" onClick={() => train.mutate()} disabled={train.isPending}>
          {train.isPending ? 'Queuing…' : 'Retrain model'}
        </Button>
      </Box>

      {/* Headline figures. design.md §1: a forecast never ships as a bare number,
          so the model's own accuracy is stated beside it. */}
      <Box className="flex flex-wrap gap-3">
        <StatTile
          label="Active model"
          value={active ? active.version.replace('demand-', '') : '—'}
          note={active ? active.algorithm : 'none activated'}
        />
        <StatTile
          label="MAE"
          value={active?.mae ? Number(active.mae).toFixed(3) : '—'}
          note={active?.baseline_mae ? `baseline ${Number(active.baseline_mae).toFixed(3)}` : ''}
        />
        <StatTile
          label="Skill ratio"
          value={skill !== null ? skill.toFixed(3) : '—'}
          note="target ≤ 0.70"
          tone={skill !== null ? (skill <= 0.7 ? 'var(--ok)' : 'var(--warn)') : undefined}
        />
        <StatTile
          label="MAPE"
          value={active?.mape ? Number(active.mape).toFixed(1) : '—'}
          unit="%"
          note={active ? `${active.valid_rows.toLocaleString()} validation rows` : ''}
        />
      </Box>

      {/* Forecast — one zone at a time.
          Eight zones would mean eight series, and the design system has no
          validated categorical scale that deep. One series needs no legend:
          the title names it. */}
      <Paper elevation={0} className="flex flex-col gap-3 p-4">
        <Box className="flex flex-wrap items-center justify-between gap-3">
          <Box>
            <Typography variant="h3" sx={{ fontSize: 18 }}>
              Predicted trips ·{' '}
              {zoneList.find((z) => z.id === activeZone)?.name ?? 'select a zone'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Next 3 hours in 15-minute slots. Shaded band is the 80% interval.
            </Typography>
          </Box>
          <TextField
            select
            size="small"
            label="Zone"
            value={activeZone}
            onChange={(e) => setZoneId(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            {zoneList.map((z) => (
              <MenuItem key={z.id} value={z.id}>
                {z.name}
              </MenuItem>
            ))}
          </TextField>
        </Box>

        {forecast.isLoading ? (
          <LoadingState rows={3} />
        ) : forecast.isError ? (
          <ErrorState
            error={forecast.error as ApiClientError}
            onRetry={() => void forecast.refetch()}
          />
        ) : chartData.length === 0 ? (
          <EmptyState
            title="No forecast yet"
            action="Train the model first — it needs history from npm run demand:backfill, and the ML service must be running."
            actionLabel="Retrain model"
            onAction={() => train.mutate()}
          />
        ) : (
          <Box className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                {/* Recessive grid: horizontal only, so it guides the eye
                    without competing with the data. */}
                <CartesianGrid
                  stroke={token('--ink-700')}
                  strokeDasharray="2 4"
                  vertical={false}
                />
                <XAxis
                  dataKey="at"
                  tick={{ fill: token('--mist-400'), fontSize: 11 }}
                  stroke={token('--ink-700')}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: token('--mist-400'), fontSize: 11 }}
                  stroke={token('--ink-700')}
                  tickLine={false}
                  width={40}
                  allowDecimals={false}
                />
                <Tooltip content={<ForecastTooltip />} cursor={{ stroke: token('--mist-400') }} />
                {/* Uncertainty first, so the point estimate reads on top. */}
                <Area
                  dataKey="band"
                  stroke="none"
                  fill={seriesColour}
                  fillOpacity={0.18}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="predicted"
                  stroke={seriesColour}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </Box>
        )}
      </Paper>

      {/* Model registry. design.md §4: a model with no recorded eval does not
          get an is_active flag, so the table shows why each one did or didn't. */}
      <Paper elevation={0} className="overflow-x-auto p-4">
        <Typography variant="h3" sx={{ fontSize: 18 }} className="mb-1">
          Model registry
        </Typography>
        <Typography variant="caption" color="text.secondary" className="mb-3 block">
          Every fit is recorded with its metrics. A model only becomes active if it beats the
          seasonal-naive baseline by the margin design.md sets.
        </Typography>

        {registry.length === 0 ? (
          <EmptyState
            title="No models trained yet"
            action="Run the backfill, then retrain — each run appears here with its metrics."
          />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                {['Version', 'Algorithm', 'MAE', 'Baseline', 'Skill', 'MAPE', 'Rows', 'State'].map(
                  (h) => (
                    <TableCell key={h}>
                      <Typography variant="overline" color="text.secondary">
                        {h}
                      </Typography>
                    </TableCell>
                  ),
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {registry.map((m) => {
                const ratio = m.skill_ratio ? Number(m.skill_ratio) : null;
                const isActive = Number(m.is_active) === 1;
                return (
                  <TableRow key={m.id}>
                    <TableCell>
                      <span className="mono">{m.version.replace('demand-', '')}</span>
                    </TableCell>
                    <TableCell>{m.algorithm}</TableCell>
                    <TableCell className="mono">
                      {m.mae ? Number(m.mae).toFixed(3) : '—'}
                    </TableCell>
                    <TableCell className="mono">
                      {m.baseline_mae ? Number(m.baseline_mae).toFixed(3) : '—'}
                    </TableCell>
                    <TableCell>
                      <span
                        className="mono"
                        style={{
                          color:
                            ratio === null
                              ? undefined
                              : ratio <= 0.7
                                ? 'var(--ok)'
                                : 'var(--warn)',
                        }}
                      >
                        {ratio !== null ? ratio.toFixed(3) : '—'}
                      </span>
                    </TableCell>
                    <TableCell className="mono">
                      {m.mape ? `${Number(m.mape).toFixed(1)}%` : '—'}
                    </TableCell>
                    <TableCell className="mono">
                      {Number(m.train_rows).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {/* Status is never colour alone — the chip carries a label. */}
                      <Chip
                        size="small"
                        variant="outlined"
                        label={isActive ? 'Active' : 'Inactive'}
                        sx={{
                          color: isActive ? 'var(--ok)' : 'var(--mist-400)',
                          borderColor: isActive ? 'var(--ok)' : 'var(--ink-700)',
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Box>
  );
}
