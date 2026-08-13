import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Chip, FormControlLabel, Paper, Switch, Typography } from '@mui/material';
import type { SegmentTrafficDto, TrafficLiveDto, ZoneDto } from '@mm/shared-types';
import { api } from '../../lib/api.ts';
import type { ApiClientError } from '../../lib/api.ts';
import { ErrorState, LoadingState } from '../../components/StateViews.tsx';
import { FLOW_LABELS, flowRamp } from '../../lib/tokens.ts';
import { StreetMap } from './StreetMap.tsx';
import { SvgCityMap } from './SvgCityMap.tsx';
import { LegendCard } from './LegendCard.tsx';

function Metric({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <Box className="flex flex-col">
      <Typography variant="overline" color="text.secondary" className="leading-none">
        {label}
      </Typography>
      <Typography variant="h3" className="mono leading-tight" sx={tint ? { color: tint } : undefined}>
        {value}
      </Typography>
    </Box>
  );
}

export function LiveScreen() {
  const [selected, setSelected] = useState<SegmentTrafficDto | null>(null);
  /**
   * Real OpenStreetMap tiles by default, via Leaflet — no WebGL, no API key,
   * no billing. The offline view draws the city from our own seeded geometry
   * and needs no network at all, which is the safety net if a venue's wifi
   * fails mid-demo.
   */
  const [renderer, setRenderer] = useState<'street' | 'offline'>('street');

  const zones = useQuery({
    queryKey: ['geo', 'zones'],
    queryFn: () => api.get<ZoneDto[]>('/geo/zones'),
    staleTime: 60 * 60 * 1000, // geography barely changes
  });

  const traffic = useQuery({
    queryKey: ['traffic', 'live'],
    queryFn: () => api.get<TrafficLiveDto>('/traffic/live'),
    // Matches the 15 s snapshot TTL. The socket pushes updates too; this is the
    // floor if the socket is down.
    refetchInterval: 15_000,
  });

  if (zones.isLoading || traffic.isLoading) return <LoadingState rows={8} />;
  if (zones.isError || traffic.isError) {
    return (
      <ErrorState
        error={(zones.error ?? traffic.error) as ApiClientError}
        onRetry={() => {
          void zones.refetch();
          void traffic.refetch();
        }}
      />
    );
  }

  const live = traffic.data!.data;
  const ramp = flowRamp();
  const measured = live.segments.filter((s) => s.computedAt !== null);
  const jammed = live.segments.filter((s) => s.flowBand >= 3).length;
  const cityBand = Math.min(4, Math.floor(live.cityCongestionIndex * 5));

  return (
    <Box className="flex h-[calc(100vh-var(--topbar-h))] flex-col">
      {/* KPI strip — M11 basic */}
      <Box className="flex flex-wrap items-center gap-8 border-b border-ink-700 px-6 py-3">
        <Metric
          label="City congestion"
          value={live.cityCongestionIndex.toFixed(2)}
          tint={ramp[cityBand]}
        />
        <Metric label="Corridors monitored" value={String(live.segments.length)} />
        <Metric label="Heavy or jammed" value={String(jammed)} tint={jammed > 0 ? ramp[3] : undefined} />
        <Box className="flex-1" />
        <Chip
          size="small"
          variant="outlined"
          label={measured.length > 0 ? FLOW_LABELS[cityBand] : 'Awaiting readings'}
          sx={{ color: ramp[cityBand], borderColor: ramp[cityBand] }}
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={renderer === 'offline'}
              onChange={(e) => setRenderer(e.target.checked ? 'offline' : 'street')}
            />
          }
          label={<Typography variant="body2">Offline map</Typography>}
        />
      </Box>

      <Box className="relative flex-1">
        {renderer === 'street' ? (
          <StreetMap
            zones={zones.data!.data}
            segments={live.segments}
            selectedId={selected?.segmentId ?? null}
            onSelectSegment={setSelected}
          />
        ) : (
          <SvgCityMap
            zones={zones.data!.data}
            segments={live.segments}
            selectedId={selected?.segmentId ?? null}
            onSelectSegment={setSelected}
          />
        )}

        <LegendCard />

        {/* Context panel — never more than a third of the canvas (design.md §6.4) */}
        {selected && (
          <Paper
            elevation={0}
            className="absolute right-4 top-4 z-10 w-[320px] max-w-[33%] p-4 shadow-card"
          >
            <Typography variant="overline" color="text.secondary">
              Segment
            </Typography>
            <Typography variant="h3" className="mb-3" sx={{ fontSize: 18 }}>
              {selected.name ?? `Segment ${selected.segmentId}`}
            </Typography>

            <Box className="grid grid-cols-2 gap-3">
              <Metric
                label="Congestion"
                value={selected.congestionIndex.toFixed(2)}
                tint={ramp[selected.flowBand]}
              />
              <Metric
                label="Mean speed"
                value={selected.meanSpeedKph === null ? '—' : `${selected.meanSpeedKph.toFixed(0)} kph`}
              />
              <Metric label="Free flow" value={`${selected.speedFreeKph.toFixed(0)} kph`} />
              <Metric label="Length" value={`${Math.round(selected.lengthM)} m`} />
            </Box>

            <Typography variant="caption" color="text.secondary" className="mt-3 block">
              {selected.roadClass} ·{' '}
              {selected.computedAt
                ? `updated ${new Date(selected.computedAt).toLocaleTimeString()}`
                : 'no readings yet'}
            </Typography>

            <Typography
              component="button"
              variant="caption"
              className="mt-3 cursor-pointer border-0 bg-transparent p-0 underline"
              color="text.secondary"
              onClick={() => setSelected(null)}
            >
              Close
            </Typography>
          </Paper>
        )}
      </Box>
    </Box>
  );
}
