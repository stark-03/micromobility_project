import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import type { LngLat } from '@mm/shared-types';
import { api } from '../../lib/api.ts';
import type { ApiClientError } from '../../lib/api.ts';
import { EmptyState, LoadingState } from '../../components/StateViews.tsx';
import { token } from '../../lib/tokens.ts';

const BELAGAVI: [number, number] = [15.8497, 74.4977];

interface StationDto {
  id: string;
  name: string;
  zoneId: string | null;
  zoneName: string | null;
  location: LngLat;
  connectors: number;
  powerKw: number;
  status: 'active' | 'offline' | 'planned';
  notes: string | null;
}

/**
 * Charging infrastructure, placed by clicking the map.
 *
 * This module exists because of something the simulator found rather than
 * something the spec asked for: every unmet trip in the baseline scenario is
 * reason code `battery`, not `no_vehicle`. The constraint is charge, not fleet
 * size — so a planner needs a way to put charging points where the shortfall is.
 *
 * The zone is derived server-side from the clicked point. Asking a planner to
 * also name the zone would invite the two to disagree.
 */
export function ChargingPanel() {
  const queryClient = useQueryClient();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);

  const [pending, setPending] = useState<LngLat | null>(null);
  const [name, setName] = useState('');
  const [connectors, setConnectors] = useState(4);
  const [powerKw, setPowerKw] = useState(3.3);
  const [status, setStatus] = useState<StationDto['status']>('active');

  const pendingRef = useRef<(p: LngLat) => void>(() => {});
  pendingRef.current = (p) => setPending(p);

  const stations = useQuery({
    queryKey: ['charging', 'stations'],
    queryFn: () => api.get<StationDto[]>('/charging/stations'),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<StationDto>('/charging/stations', {
        name: name.trim(),
        location: pending,
        connectors,
        powerKw,
        status,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['charging'] });
      setPending(null);
      setName('');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/charging/stations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['charging'] }),
  });

  // ---- map, created once ---------------------------------------------------
  useEffect(() => {
    if (!container.current || map.current) return;

    const m = L.map(container.current, {
      center: BELAGAVI,
      zoom: 13,
      preferCanvas: true,
    });
    map.current = m;

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
      crossOrigin: true,
    }).addTo(m);

    markers.current = L.layerGroup().addTo(m);
    container.current.style.cursor = 'crosshair';

    m.on('click', (e: L.LeafletMouseEvent) => {
      pendingRef.current([
        Number(e.latlng.lng.toFixed(6)),
        Number(e.latlng.lat.toFixed(6)),
      ]);
    });

    return () => {
      m.remove();
      map.current = null;
      markers.current = null;
    };
  }, []);

  // ---- existing stations + the pin being placed ----------------------------
  useEffect(() => {
    const layer = markers.current;
    if (!layer) return;
    layer.clearLayers();

    const bolt = (colour: string, ring: string) =>
      L.divIcon({
        className: '',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        html: `<div style="width:20px;height:20px;border-radius:6px;background:${colour};
          border:2px solid ${ring};display:flex;align-items:center;justify-content:center;
          font:700 12px/1 system-ui;color:#0b1220">⚡</div>`,
      });

    for (const s of stations.data?.data ?? []) {
      L.marker([s.location[1], s.location[0]], {
        icon: bolt(s.status === 'active' ? token('--warn') : token('--mist-400'), '#0b1220'),
      })
        .bindTooltip(`${s.name} · ${s.connectors} points · ${s.powerKw} kW · ${s.status}`, {
          direction: 'top',
        })
        .addTo(layer);
    }

    if (pending) {
      L.marker([pending[1], pending[0]], {
        icon: bolt(token('--series-1'), '#ffffff'),
        zIndexOffset: 1000,
      })
        .bindTooltip('New station here', { direction: 'top', permanent: true })
        .addTo(layer);
    }
  }, [stations.data, pending]);

  const list = stations.data?.data ?? [];
  const error = create.error as ApiClientError | null;

  return (
    <Box className="flex flex-col gap-4 lg:flex-row">
      <Box className="min-h-[440px] flex-1 overflow-hidden rounded-lg border border-ink-700">
        <div ref={container} className="h-full min-h-[440px] w-full" data-testid="charging-map" />
      </Box>

      <Box className="flex w-full flex-col gap-3 lg:w-[360px] lg:shrink-0">
        <Paper elevation={0} className="flex flex-col gap-3 p-4 shadow-card">
          <Typography variant="overline" color="text.secondary">
            Add a charging station
          </Typography>

          {!pending ? (
            <Typography variant="body2" color="text.secondary">
              Click anywhere on the map to place one. Its zone is worked out from where you clicked.
            </Typography>
          ) : (
            <>
              <Typography variant="body2" className="mono">
                {pending[1].toFixed(5)}, {pending[0].toFixed(5)}
              </Typography>

              <TextField
                label="Name"
                size="small"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Vadgaon Market"
                autoFocus
                required
              />

              <Box className="grid grid-cols-2 gap-3">
                <TextField
                  label="Charge points"
                  type="number"
                  size="small"
                  value={connectors}
                  onChange={(e) => setConnectors(Math.max(1, Number(e.target.value)))}
                />
                <TextField
                  label="kW each"
                  type="number"
                  size="small"
                  value={powerKw}
                  onChange={(e) => setPowerKw(Math.max(0.5, Number(e.target.value)))}
                />
              </Box>

              <TextField
                label="Status"
                select
                size="small"
                value={status}
                onChange={(e) => setStatus(e.target.value as StationDto['status'])}
              >
                <MenuItem value="active">Active — riders can see it</MenuItem>
                <MenuItem value="planned">Planned — not yet built</MenuItem>
                <MenuItem value="offline">Offline</MenuItem>
              </TextField>

              {error && (
                <Typography variant="body2" sx={{ color: 'var(--danger)' }}>
                  {error.message}
                </Typography>
              )}

              <Box className="flex gap-2">
                <Button
                  variant="contained"
                  onClick={() => create.mutate()}
                  disabled={name.trim().length < 2 || create.isPending}
                >
                  {create.isPending ? 'Saving…' : 'Add station'}
                </Button>
                <Button variant="text" color="inherit" onClick={() => setPending(null)}>
                  Cancel
                </Button>
              </Box>
            </>
          )}
        </Paper>

        <Paper elevation={0} className="flex flex-col gap-2 p-4 shadow-card">
          <Typography variant="overline" color="text.secondary">
            {list.length} stations
          </Typography>

          {stations.isLoading ? (
            <LoadingState rows={3} />
          ) : list.length === 0 ? (
            <EmptyState title="No stations" action="Click the map to place the first one." />
          ) : (
            list.map((s) => (
              <Box
                key={s.id}
                className="flex items-center gap-3 border-b border-ink-800 py-2 last:border-b-0"
              >
                <Box className="min-w-0 flex-1">
                  <Typography variant="body2" className="truncate">
                    {s.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" className="mono">
                    {s.connectors} × {s.powerKw} kW · {s.location[1].toFixed(4)},{' '}
                    {s.location[0].toFixed(4)}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  variant="outlined"
                  label={s.status}
                  sx={{
                    color: s.status === 'active' ? 'var(--ok)' : 'var(--mist-400)',
                    borderColor: s.status === 'active' ? 'var(--ok)' : 'var(--mist-400)',
                  }}
                />
                <Button
                  size="small"
                  variant="text"
                  color="inherit"
                  onClick={() => remove.mutate(s.id)}
                >
                  Remove
                </Button>
              </Box>
            ))
          )}
        </Paper>
      </Box>
    </Box>
  );
}
