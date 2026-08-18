import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Slider,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { api } from '../../lib/api.ts';
import { EmptyState, ErrorState, LoadingState } from '../../components/StateViews.tsx';

/**
 * M07 rebalance planner.
 *
 * The screen's job is to make a plan *arguable*: a planner should be able to
 * see why each move was chosen and what it costs, not just receive a list.
 * So the supply table shows the target beside the actual, and the plan shows
 * the imbalance it closes beside the kilometres it spends doing it.
 */

interface ZoneSupplyDto {
  zoneId: string;
  name: string;
  code: string;
  supply: number;
  forecastDemand: number;
  targetVehicles: number;
  gap: number;
}

interface TaskDto {
  id: string;
  sequence: number;
  fromZoneName: string;
  toZoneName: string;
  vehicles: number;
  distanceKm: number;
  status: string;
  completedAt: string | null;
}

interface PlanDto {
  id: string;
  status: string;
  vanCount: number;
  vanCapacity: number;
  totalVehicles: number;
  totalDistanceKm: number;
  deficitBefore: number;
  deficitAfter: number;
  notes: string[];
  createdAt: string;
  tasks: TaskDto[];
}

function GapBar({ gap, scale }: { gap: number; scale: number }) {
  const pct = Math.min(100, (Math.abs(gap) / Math.max(0.5, scale)) * 50);
  const over = gap > 0;

  return (
    <Box className="flex h-4 w-full items-center" aria-hidden>
      <Box className="flex h-full w-1/2 justify-end">
        {!over && (
          <Box
            className="h-2 self-center rounded-l-sm"
            sx={{ width: `${pct}%`, background: 'var(--danger)' }}
          />
        )}
      </Box>
      <Box className="h-full w-px" sx={{ background: 'var(--ink-700)' }} />
      <Box className="h-full w-1/2">
        {over && (
          <Box
            className="h-2 self-center rounded-r-sm"
            sx={{ width: `${pct}%`, background: 'var(--ok)', marginTop: '4px' }}
          />
        )}
      </Box>
    </Box>
  );
}

export function RebalancePanel() {
  const queryClient = useQueryClient();
  const [vanCount, setVanCount] = useState(2);
  const [vanCapacity, setVanCapacity] = useState(8);
  const [valueKm, setValueKm] = useState(6);
  const [horizonHours, setHorizonHours] = useState(2);
  const [planId, setPlanId] = useState<string | null>(null);

  const supply = useQuery({
    queryKey: ['fleet', 'supply-demand', horizonHours],
    queryFn: () => api.get<ZoneSupplyDto[]>(`/fleet/supply-demand?horizonHours=${horizonHours}`),
  });

  const plans = useQuery({
    queryKey: ['fleet', 'plans'],
    queryFn: () => api.get<PlanDto[]>('/fleet/rebalance/plans'),
  });

  const createPlan = useMutation({
    mutationFn: () =>
      api.post<PlanDto>('/fleet/rebalance/plan', {
        horizonHours,
        vanCount,
        vanCapacity,
        valuePerVehicleKm: valueKm,
      }),
    onSuccess: (res) => {
      setPlanId(res.data.id);
      void queryClient.invalidateQueries({ queryKey: ['fleet'] });
    },
  });

  const setTask = useMutation({
    mutationFn: (v: { id: string; status: string }) =>
      api.patch(`/fleet/rebalance/tasks/${v.id}`, { status: v.status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fleet', 'plans'] }),
  });

  const zones = supply.data?.data ?? [];
  const planList = plans.data?.data ?? [];
  const plan = planList.find((p) => p.id === planId) ?? planList[0] ?? null;
  const worstGap = Math.max(1, ...zones.map((z) => Math.abs(z.gap)));
  const imbalance = zones.reduce((n, z) => n + Math.max(0, -z.gap), 0);

  if (supply.isError) {
    return <ErrorState error={supply.error} onRetry={() => void supply.refetch()} />;
  }

  return (
    <Box className="flex flex-col gap-4 lg:flex-row">
      {/* ---- supply vs target ---- */}
      <Box className="flex min-w-0 flex-1 flex-col gap-3">
        <Paper elevation={0} className="flex flex-col gap-3 p-4 shadow-card">
          <Box className="flex flex-wrap items-baseline justify-between gap-2">
            <Typography variant="overline" color="text.secondary">
              Where the fleet is, and where it should be
            </Typography>
            <Tooltip title="Total vehicles standing in zones that are under their share">
              <Typography variant="body2" className="mono" color="text.secondary">
                imbalance {imbalance.toFixed(1)} vehicles
              </Typography>
            </Tooltip>
          </Box>

          <Typography variant="caption" color="text.secondary">
            Target is each zone&apos;s share of the fleet that exists, weighted by forecast demand
            over the next {horizonHours}h. Rebalancing cannot create vehicles — it decides where the
            ones you have should stand.
          </Typography>

          {supply.isLoading ? (
            <LoadingState rows={4} />
          ) : zones.length === 0 ? (
            <EmptyState title="No zones" action="Seed the city first: npm run db:seed" />
          ) : (
            <Box className="flex flex-col">
              <Box className="grid grid-cols-[1fr_3rem_3.5rem_5rem_1fr] items-baseline gap-2 border-b border-ink-700 pb-1">
                {['Zone', 'Have', 'Target', 'Gap', 'Short ← → Spare'].map((h) => (
                  <Typography key={h} variant="caption" color="text.secondary">
                    {h}
                  </Typography>
                ))}
              </Box>
              {zones.map((z) => (
                <Box
                  key={z.zoneId}
                  className="grid grid-cols-[1fr_3rem_3.5rem_5rem_1fr] items-center gap-2 border-b border-ink-800 py-1.5"
                >
                  <Typography variant="body2">{z.name}</Typography>
                  <Typography variant="body2" className="mono">
                    {z.supply}
                  </Typography>
                  <Typography variant="body2" className="mono" color="text.secondary">
                    {z.targetVehicles.toFixed(1)}
                  </Typography>
                  <Typography
                    variant="body2"
                    className="mono"
                    sx={{ color: z.gap < -0.5 ? 'var(--danger)' : z.gap > 0.5 ? 'var(--ok)' : 'var(--mist-400)' }}
                  >
                    {z.gap > 0 ? '+' : ''}
                    {z.gap.toFixed(1)}
                  </Typography>
                  <GapBar gap={z.gap} scale={worstGap} />
                </Box>
              ))}
            </Box>
          )}
        </Paper>
      </Box>

      {/* ---- solve + tasks ---- */}
      <Box className="flex w-full flex-col gap-3 lg:w-96 lg:shrink-0">
        <Paper elevation={0} className="flex flex-col gap-3 p-4 shadow-card">
          <Typography variant="overline" color="text.secondary">
            Crew resources
          </Typography>

          <Box className="grid grid-cols-2 gap-3">
            <TextField
              label="Vans"
              type="number"
              size="small"
              value={vanCount}
              onChange={(e) => setVanCount(Math.max(0, Number(e.target.value)))}
            />
            <TextField
              label="Capacity each"
              type="number"
              size="small"
              value={vanCapacity}
              onChange={(e) => setVanCapacity(Math.max(1, Number(e.target.value)))}
            />
          </Box>

          <Box>
            <Typography variant="caption" color="text.secondary">
              Worth driving {valueKm} km to place one vehicle
            </Typography>
            <Slider
              value={valueKm}
              onChange={(_e, v) => setValueKm(v as number)}
              min={0}
              max={30}
              step={0.5}
              size="small"
            />
            <Typography variant="caption" color="text.secondary">
              Below this the haul costs more than the trips it enables, and the solver declines it.
            </Typography>
          </Box>

          <TextField
            label="Demand horizon"
            select
            size="small"
            SelectProps={{ native: true }}
            value={horizonHours}
            onChange={(e) => setHorizonHours(Number(e.target.value))}
          >
            <option value={1}>next 1 hour</option>
            <option value={2}>next 2 hours</option>
            <option value={4}>next 4 hours</option>
            <option value={8}>next 8 hours</option>
          </TextField>

          <Button
            variant="contained"
            onClick={() => createPlan.mutate()}
            disabled={createPlan.isPending}
          >
            {createPlan.isPending ? 'Solving…' : 'Solve rebalancing'}
          </Button>

          {createPlan.isPending && <LinearProgress />}
          {createPlan.isError && (
            <Typography variant="body2" sx={{ color: 'var(--danger)' }}>
              {(createPlan.error as Error).message}
            </Typography>
          )}
        </Paper>

        {plan && (
          <Paper elevation={0} className="flex flex-col gap-3 p-4 shadow-card">
            <Box className="flex items-center justify-between gap-2">
              <Typography variant="overline" color="text.secondary">
                Plan {plan.id}
              </Typography>
              <Chip size="small" variant="outlined" label={plan.status} />
            </Box>

            <Box className="grid grid-cols-2 gap-2">
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Imbalance closed
                </Typography>
                <Typography variant="h3" className="mono" sx={{ fontSize: 20, color: 'var(--ok)' }}>
                  {(plan.deficitBefore - plan.deficitAfter).toFixed(1)}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Van kilometres
                </Typography>
                <Typography variant="h3" className="mono" sx={{ fontSize: 20 }}>
                  {plan.totalDistanceKm.toFixed(1)}
                </Typography>
              </Box>
            </Box>

            {plan.notes.length > 0 && (
              <Typography variant="caption" sx={{ color: 'var(--warn)' }}>
                {plan.notes.join(' · ')}
              </Typography>
            )}

            {plan.tasks.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                The solver found no move worth making. Raise the value per vehicle, or add vans.
              </Typography>
            ) : (
              <Box className="flex flex-col gap-1">
                <Typography variant="caption" color="text.secondary">
                  Crew tasks — longest haul first, so a shortened shift drops the least justifiable
                  moves
                </Typography>
                {plan.tasks.map((t) => (
                  <Box
                    key={t.id}
                    className="flex items-center justify-between gap-2 border-b border-ink-800 py-1.5"
                  >
                    <Box className="min-w-0">
                      <Typography variant="body2" className="truncate">
                        {t.fromZoneName} → {t.toZoneName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" className="mono">
                        {t.vehicles} vehicle{t.vehicles === 1 ? '' : 's'} · {t.distanceKm.toFixed(1)} km
                      </Typography>
                    </Box>
                    {t.status === 'pending' ? (
                      <Box className="flex shrink-0 gap-1">
                        <Button size="small" onClick={() => setTask.mutate({ id: t.id, status: 'done' })}>
                          Done
                        </Button>
                        <Button
                          size="small"
                          variant="text"
                          color="inherit"
                          onClick={() => setTask.mutate({ id: t.id, status: 'skipped' })}
                        >
                          Skip
                        </Button>
                      </Box>
                    ) : (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={t.status}
                        sx={{
                          color: t.status === 'done' ? 'var(--ok)' : 'var(--mist-400)',
                          borderColor: t.status === 'done' ? 'var(--ok)' : 'var(--mist-400)',
                        }}
                      />
                    )}
                  </Box>
                ))}
              </Box>
            )}
          </Paper>
        )}
      </Box>
    </Box>
  );
}
