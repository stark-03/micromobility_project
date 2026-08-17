import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Button,
  Chip,
  LinearProgress,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  CompareRowDto,
  RunComparisonDto,
  ScenarioDto,
  SimulationRunDto,
  SimulationTimelinePointDto,
} from '@mm/shared-types';
import { api } from '../../lib/api.ts';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews.tsx';
import { NewScenarioDialog } from './NewScenarioDialog.tsx';
import { useRunProgress } from './useRunProgress.ts';

/** Label, unit and precision for every metric the Results panel shows. */
const METRIC_META: Record<string, { label: string; unit: string; digits: number }> = {
  tripsServed: { label: 'Trips served', unit: '', digits: 0 },
  tripsUnserved: { label: 'Unmet demand', unit: '', digits: 0 },
  serviceRatePct: { label: 'Service rate', unit: '%', digits: 1 },
  meanWaitSeconds: { label: 'Mean wait', unit: 's', digits: 0 },
  meanTripSeconds: { label: 'Mean trip', unit: 's', digits: 0 },
  vehicleUtilizationPct: { label: 'Utilisation', unit: '%', digits: 1 },
  distanceLoadedKm: { label: 'Loaded', unit: 'km', digits: 0 },
  distanceEmptyKm: { label: 'Empty', unit: 'km', digits: 0 },
  emptyRatioPct: { label: 'Empty ratio', unit: '%', digits: 1 },
  carKmReplaced: { label: 'Car km replaced', unit: 'km', digits: 0 },
  co2AvoidedKg: { label: 'CO₂ avoided', unit: 'kg', digits: 0 },
  safetyIncidents: { label: 'Expected incidents', unit: '', digits: 2 },
  incidentsPer1000Km: { label: 'Incidents / 1000 km', unit: '', digits: 3 },
  rebalanceMoves: { label: 'Rebalance moves', unit: '', digits: 0 },
  fleetSize: { label: 'Fleet', unit: '', digits: 0 },
};

/** The six a planner reads first; the rest are secondary. */
const HEADLINE = [
  'tripsServed',
  'tripsUnserved',
  'serviceRatePct',
  'meanWaitSeconds',
  'vehicleUtilizationPct',
  'incidentsPer1000Km',
];

const UNSERVED_REASON: Record<string, string> = {
  battery: 'no charged vehicle',
  no_vehicle: 'no vehicle nearby',
  closed_zone: 'zone closed by policy',
};

function fmt(value: number, digits: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function StatusChip({ status }: { status: SimulationRunDto['status'] }) {
  const colour =
    status === 'completed'
      ? 'var(--ok)'
      : status === 'failed'
        ? 'var(--danger)'
        : status === 'running'
          ? 'var(--series-1)'
          : 'var(--mist-400)';

  return (
    <Chip
      size="small"
      variant="outlined"
      label={status}
      sx={{ color: colour, borderColor: colour, textTransform: 'capitalize' }}
    />
  );
}

function MetricTile({ metricKey, value }: { metricKey: string; value: number }) {
  const meta = METRIC_META[metricKey] ?? { label: metricKey, unit: '', digits: 2 };
  return (
    <Box className="flex flex-col rounded-md border border-ink-700 p-3">
      <Typography variant="overline" color="text.secondary" className="leading-none">
        {meta.label}
      </Typography>
      <Typography variant="h3" className="mono leading-tight" sx={{ fontSize: 22 }}>
        {fmt(value, meta.digits)}
        {meta.unit && (
          <Typography component="span" variant="caption" color="text.secondary" className="ml-1">
            {meta.unit}
          </Typography>
        )}
      </Typography>
    </Box>
  );
}

/**
 * One row of a comparison.
 *
 * Colour is never the only cue — the arrow and the word carry the same meaning,
 * so the verdict survives a colourblind reader and a black-and-white printout.
 */
function CompareRow({ row }: { row: CompareRowDto }) {
  const meta = METRIC_META[row.metric] ?? { label: row.metric, unit: '', digits: 2 };
  const colour =
    row.direction === 'better'
      ? 'var(--ok)'
      : row.direction === 'worse'
        ? 'var(--danger)'
        : 'var(--mist-400)';
  const arrow = row.direction === 'same' ? '—' : row.delta > 0 ? '▲' : '▼';

  return (
    <Box className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-3 border-b border-ink-800 py-2">
      <Typography variant="body2">{meta.label}</Typography>
      <Typography variant="body2" color="text.secondary" className="mono">
        {fmt(row.baseline, meta.digits)}
      </Typography>
      <Typography variant="body2" className="mono">
        {fmt(row.variant, meta.digits)}
      </Typography>
      <Typography variant="body2" className="mono whitespace-nowrap" sx={{ color: colour }}>
        {arrow} {row.deltaPct === null ? '—' : `${row.deltaPct > 0 ? '+' : ''}${row.deltaPct}%`}
      </Typography>
    </Box>
  );
}

function Timeline({ points }: { points: SimulationTimelinePointDto[] }) {
  const data = points.map((p) => ({
    hour: p.simMinutes / 60,
    served: p.tripsServed,
    unserved: p.tripsUnserved,
  }));

  return (
    <Box className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--ink-700)" vertical={false} />
          <XAxis
            dataKey="hour"
            tick={{ fill: 'var(--mist-400)', fontSize: 11 }}
            tickFormatter={(h: number) => `${String(Math.floor(h)).padStart(2, '0')}:00`}
            stroke="var(--ink-700)"
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fill: 'var(--mist-400)', fontSize: 11 }} stroke="var(--ink-700)" />
          <ChartTooltip
            contentStyle={{
              background: 'var(--ink-900)',
              border: '1px solid var(--ink-700)',
              borderRadius: 8,
              color: 'var(--mist-100)',
            }}
            labelFormatter={(h) => `${String(Math.floor(Number(h))).padStart(2, '0')}:00`}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: 'var(--mist-400)' }} />
          <Area
            type="monotone"
            dataKey="served"
            name="Served"
            stroke="var(--series-1)"
            fill="var(--series-1)"
            fillOpacity={0.22}
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="unserved"
            name="Unmet"
            stroke="var(--series-2)"
            fill="var(--series-2)"
            fillOpacity={0.22}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}

function ScenarioCard({
  scenario,
  selected,
  onSelect,
}: {
  scenario: ScenarioDto;
  selected: boolean;
  onSelect: () => void;
}) {
  const run = scenario.latestRun;
  const levers: string[] = [];
  if (scenario.policy.bikeLaneZones.length > 0) {
    levers.push(`${scenario.policy.bikeLaneZones.length} zones with bike lanes`);
  }
  if (scenario.policy.closedZones.length > 0) {
    levers.push(`${scenario.policy.closedZones.length} zones closed`);
  }
  if (scenario.policy.rebalanceEnabled) levers.push('rebalancing on');
  if (scenario.weather.precipitationMm > 0) levers.push(`${scenario.weather.precipitationMm} mm rain`);
  if (scenario.policy.demandMultiplier !== 1) {
    levers.push(`demand ×${scenario.policy.demandMultiplier}`);
  }

  return (
    <Paper
      elevation={0}
      onClick={onSelect}
      className="cursor-pointer p-3 shadow-card"
      sx={{
        borderLeft: '3px solid',
        borderLeftColor: selected ? 'var(--series-1)' : 'transparent',
        background: selected ? 'var(--ink-800)' : undefined,
      }}
    >
      <Box className="flex items-start justify-between gap-2">
        <Typography variant="body1" sx={{ fontWeight: 500 }}>
          {scenario.name}
        </Typography>
        {run && <StatusChip status={run.status} />}
      </Box>

      <Typography variant="caption" color="text.secondary" className="mt-1 block">
        {levers.length > 0 ? levers.join(' · ') : 'no interventions — baseline'}
      </Typography>

      <Typography variant="caption" color="text.secondary" className="mt-1 block">
        {scenario.fleet.scooter + scenario.fleet.ebike + scenario.fleet.bike} vehicles ·{' '}
        {scenario.simHours}h · {scenario.runCount} {scenario.runCount === 1 ? 'run' : 'runs'}
      </Typography>
    </Paper>
  );
}

export function SimScreen() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareWith, setCompareWith] = useState<string>('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const scenarios = useQuery({
    queryKey: ['sim', 'scenarios'],
    queryFn: () => api.get<ScenarioDto[]>('/scenarios'),
    // A queued run flips to completed within a second or two; without a poll a
    // planner whose socket did not connect would stare at "queued" forever.
    refetchInterval: (q) =>
      (q.state.data?.data ?? []).some((s) => s.latestRun && s.latestRun.status !== 'completed' && s.latestRun.status !== 'failed')
        ? 1500
        : false,
  });

  const list = scenarios.data?.data ?? [];
  const selected = list.find((s) => s.id === selectedId) ?? list[0] ?? null;
  const activeRun = selected?.latestRun ?? null;
  const liveProgress = useRunProgress(
    activeRun && (activeRun.status === 'queued' || activeRun.status === 'running')
      ? activeRun.id
      : null,
  );

  const timeline = useQuery({
    queryKey: ['sim', 'timeline', activeRun?.id],
    queryFn: () => api.get<SimulationTimelinePointDto[]>(`/runs/${activeRun!.id}/timeline`),
    enabled: Boolean(activeRun && activeRun.status === 'completed'),
  });

  const comparison = useQuery({
    queryKey: ['sim', 'compare', compareWith, activeRun?.id],
    queryFn: () =>
      api.post<RunComparisonDto>('/runs/compare', { runIds: [compareWith, activeRun!.id] }),
    enabled: Boolean(compareWith && activeRun && activeRun.status === 'completed'),
  });

  const run = useMutation({
    mutationFn: (scenarioId: string) => api.post<SimulationRunDto>(`/scenarios/${scenarioId}/runs`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sim', 'scenarios'] }),
  });

  /** Completed runs of *other* scenarios — the candidates to compare against. */
  const baselineOptions = useMemo(
    () =>
      list
        .filter((s) => s.id !== selected?.id && s.latestRun?.status === 'completed')
        .map((s) => ({ id: s.latestRun!.id, name: s.name })),
    [list, selected?.id],
  );

  if (scenarios.isLoading) return <LoadingState />;
  if (scenarios.isError) {
    return (
      <ErrorState error={scenarios.error} onRetry={() => void scenarios.refetch()} />
    );
  }

  const metrics = activeRun?.metrics ?? {};
  const detail = (activeRun?.detail ?? {}) as {
    byKind?: Record<string, { count: number; trips: number; utilizationPct: number; meanEndBatteryPct: number }>;
    unservedReasons?: Record<string, number>;
  };
  const secondary = Object.keys(METRIC_META).filter(
    (k) => !HEADLINE.includes(k) && k in metrics,
  );

  return (
    <Box className="flex flex-col gap-4 p-4 lg:flex-row">
      {/* ---- scenarios ---- */}
      <Box className="flex w-full flex-col gap-3 lg:w-80 lg:shrink-0">
        <Box className="flex items-center justify-between">
          <Typography variant="overline" color="text.secondary">
            Scenarios
          </Typography>
          <Button size="small" variant="contained" onClick={() => setDialogOpen(true)}>
            New
          </Button>
        </Box>

        {list.length === 0 ? (
          <EmptyState
            title="No scenarios yet"
            action="Create one to test a policy before the city builds it."
            actionLabel="New scenario"
            onAction={() => setDialogOpen(true)}
          />
        ) : (
          list.map((s) => (
            <ScenarioCard
              key={s.id}
              scenario={s}
              selected={selected?.id === s.id}
              onSelect={() => {
                setSelectedId(s.id);
                setCompareWith('');
              }}
            />
          ))
        )}
      </Box>

      {/* ---- results ---- */}
      <Box className="flex min-w-0 flex-1 flex-col gap-4">
        {!selected ? (
          <EmptyState title="Pick a scenario" action="Select one on the left to see its results." />
        ) : (
          <>
            <Paper elevation={0} className="flex flex-col gap-3 p-4 shadow-card">
              <Box className="flex flex-wrap items-start justify-between gap-3">
                <Box className="min-w-0">
                  <Typography variant="h3" sx={{ fontSize: 20 }}>
                    {selected.name}
                  </Typography>
                  {selected.description && (
                    <Typography variant="body2" color="text.secondary" className="mt-1">
                      {selected.description}
                    </Typography>
                  )}
                </Box>
                <Button
                  variant="contained"
                  onClick={() => run.mutate(selected.id)}
                  disabled={run.isPending || activeRun?.status === 'running'}
                >
                  {run.isPending ? 'Queuing…' : 'Run simulation'}
                </Button>
              </Box>

              {activeRun && activeRun.status !== 'completed' && activeRun.status !== 'failed' && (
                <Box className="flex flex-col gap-1">
                  <LinearProgress
                    variant={liveProgress ? 'determinate' : 'indeterminate'}
                    value={(liveProgress?.pct ?? 0) * 100}
                  />
                  <Typography variant="caption" color="text.secondary" className="mono">
                    {liveProgress
                      ? `${Math.round(liveProgress.pct * 100)}% · ${liveProgress.tripsServed} served, ${liveProgress.tripsUnserved} unmet`
                      : 'Queued…'}
                  </Typography>
                </Box>
              )}

              {activeRun?.status === 'failed' && (
                <Typography variant="body2" sx={{ color: 'var(--danger)' }}>
                  Run failed: {activeRun.error}
                </Typography>
              )}

              {activeRun?.status === 'completed' && (
                <Typography variant="caption" color="text.secondary" className="mono">
                  seed {activeRun.seed} · {activeRun.durationMs} ms · same seed reproduces this run
                  exactly
                </Typography>
              )}
            </Paper>

            {activeRun?.status === 'completed' ? (
              <>
                <Paper elevation={0} className="flex flex-col gap-3 p-4 shadow-card">
                  <Typography variant="overline" color="text.secondary">
                    Results
                  </Typography>
                  <Box className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                    {HEADLINE.filter((k) => k in metrics).map((k) => (
                      <MetricTile key={k} metricKey={k} value={metrics[k]!} />
                    ))}
                  </Box>

                  {detail.unservedReasons && Object.keys(detail.unservedReasons).length > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      Unmet demand:{' '}
                      {Object.entries(detail.unservedReasons)
                        .map(([reason, n]) => `${n} — ${UNSERVED_REASON[reason] ?? reason}`)
                        .join(' · ')}
                    </Typography>
                  )}
                </Paper>

                <Paper elevation={0} className="flex flex-col gap-2 p-4 shadow-card">
                  <Typography variant="overline" color="text.secondary">
                    Demand through the day
                  </Typography>
                  {timeline.isLoading ? (
                    <LoadingState rows={3} />
                  ) : (timeline.data?.data ?? []).length === 0 ? (
                    <EmptyState title="No timeline" action="This run recorded no buckets." />
                  ) : (
                    <Timeline points={timeline.data!.data} />
                  )}
                </Paper>

                <Paper elevation={0} className="flex flex-col gap-3 p-4 shadow-card">
                  <Box className="flex flex-wrap items-center justify-between gap-2">
                    <Typography variant="overline" color="text.secondary">
                      Compare against
                    </Typography>
                    <TextField
                      select
                      size="small"
                      value={compareWith}
                      onChange={(e) => setCompareWith(e.target.value)}
                      sx={{ minWidth: 240 }}
                      disabled={baselineOptions.length === 0}
                      helperText={
                        baselineOptions.length === 0
                          ? 'Run another scenario to compare'
                          : undefined
                      }
                    >
                      <MenuItem value="">None</MenuItem>
                      {baselineOptions.map((o) => (
                        <MenuItem key={o.id} value={o.id}>
                          {o.name}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Box>

                  {comparison.data && (
                    <>
                      <Box className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-b border-ink-700 pb-1">
                        <Typography variant="caption" color="text.secondary">
                          Metric
                        </Typography>
                        <Tooltip title={comparison.data.data.baseline.scenarioName ?? ''}>
                          <Typography variant="caption" color="text.secondary">
                            Baseline
                          </Typography>
                        </Tooltip>
                        <Typography variant="caption" color="text.secondary">
                          This run
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Change
                        </Typography>
                      </Box>
                      {comparison.data.data.rows.map((r) => (
                        <CompareRow key={r.metric} row={r} />
                      ))}
                    </>
                  )}
                </Paper>

                <Paper elevation={0} className="flex flex-col gap-3 p-4 shadow-card">
                  <Typography variant="overline" color="text.secondary">
                    Detail
                  </Typography>
                  <Box className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-5">
                    {secondary.map((k) => (
                      <MetricTile key={k} metricKey={k} value={metrics[k]!} />
                    ))}
                  </Box>

                  {detail.byKind && (
                    <Box className="mt-2 flex flex-col gap-1">
                      {Object.entries(detail.byKind).map(([kind, v]) => (
                        <Typography key={kind} variant="caption" color="text.secondary" className="mono">
                          {kind.padEnd(8)} {v.count} vehicles · {v.trips} trips ·{' '}
                          {v.utilizationPct}% utilised · ends at {v.meanEndBatteryPct}% battery
                        </Typography>
                      ))}
                    </Box>
                  )}
                </Paper>
              </>
            ) : activeRun?.status === 'failed' ? null : (
              <EmptyState
                title="No results yet"
                action="Run this scenario to see what the policy does to the city."
                actionLabel="Run simulation"
                onAction={() => run.mutate(selected.id)}
              />
            )}
          </>
        )}
      </Box>

      <NewScenarioDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Box>
  );
}
