import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Box, Typography } from '@mui/material';
import type { LngLat, RouteDto } from '@mm/shared-types';
import { token } from '../../lib/tokens.ts';

const BELAGAVI: [number, number] = [15.8497, 74.4977]; // Leaflet is [lat, lng]

export interface NearbyVehicle {
  id: string;
  externalRef: string;
  type: string;
  batteryPct: number | null;
  location: LngLat;
  distanceM: number;
  rangeM: number;
}

export interface ChargingStation {
  id: string;
  name: string;
  location: LngLat;
  connectors: number;
  powerKw: number;
  distanceM?: number;
}

export interface RouteMapProps {
  pickup: LngLat | null;
  drop: LngLat | null;
  /** Which point the next map click sets. */
  picking: 'pickup' | 'drop';
  routes: RouteDto[];
  selectedProfile: string;
  vehicles: NearbyVehicle[];
  stations: ChargingStation[];
  onPick: (point: LngLat) => void;
}

/**
 * The journey map.
 *
 * Leaflet rather than MapLibre, for the reason recorded on the Live map: no
 * WebGL, no worker, no graphics driver — three independent things that each
 * fail to an identical blank rectangle.
 *
 * **Only the selected route is drawn in full colour.** Three overlapping
 * polylines down the same corridor are unreadable, and colouring them as a
 * categorical trio would need a third validated hue this design system does
 * not have. The alternatives stay as faint context so you can see they differ;
 * the cards underneath carry the actual comparison.
 */
export function RouteMap({
  pickup,
  drop,
  picking,
  routes,
  selectedProfile,
  vehicles,
  stations,
  onPick,
}: RouteMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const routeLayer = useRef<L.LayerGroup | null>(null);
  const pinLayer = useRef<L.LayerGroup | null>(null);
  const poiLayer = useRef<L.LayerGroup | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);

  // Handlers change every render; the map is created once. A ref keeps the
  // click handler pointing at the current props without re-creating the map.
  const latest = useRef({ onPick, picking });
  latest.current = { onPick, picking };

  // ---- create once ---------------------------------------------------------
  useEffect(() => {
    if (!container.current || map.current) return;

    const m = L.map(container.current, {
      center: BELAGAVI,
      zoom: 14,
      preferCanvas: true,
      zoomControl: true,
      attributionControl: true,
    });
    map.current = m;

    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // Required by the ODbL licence. Do not remove.
      attribution: '&copy; OpenStreetMap contributors',
      crossOrigin: true,
    });
    tiles.on('tileerror', () => setTilesFailed(true));
    tiles.on('tileload', () => setTilesFailed(false));
    tiles.addTo(m);

    routeLayer.current = L.layerGroup().addTo(m);
    poiLayer.current = L.layerGroup().addTo(m);
    pinLayer.current = L.layerGroup().addTo(m);

    m.on('click', (e: L.LeafletMouseEvent) => {
      // Leaflet gives [lat, lng]; everything in this codebase speaks [lng, lat].
      latest.current.onPick([
        Number(e.latlng.lng.toFixed(6)),
        Number(e.latlng.lat.toFixed(6)),
      ]);
    });

    return () => {
      m.remove();
      map.current = null;
      routeLayer.current = null;
      pinLayer.current = null;
      poiLayer.current = null;
    };
  }, []);

  // The cursor is the only affordance telling you a click will drop a pin.
  useEffect(() => {
    if (container.current) container.current.style.cursor = 'crosshair';
  }, [picking]);

  // ---- pickup / drop pins --------------------------------------------------
  useEffect(() => {
    const layer = pinLayer.current;
    if (!layer) return;
    layer.clearLayers();

    const pin = (p: LngLat, label: string, colour: string) =>
      L.marker([p[1], p[0]], {
        interactive: false,
        zIndexOffset: 1000,
        icon: L.divIcon({
          className: '',
          iconSize: [28, 28],
          iconAnchor: [14, 28],
          html: `<div style="
            width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
            background:${colour};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.5);
            display:flex;align-items:center;justify-content:center;">
              <span style="transform:rotate(45deg);color:#fff;font:600 13px/1 system-ui">${label}</span>
            </div>`,
        }),
      }).addTo(layer);

    if (pickup) pin(pickup, 'A', token('--series-1'));
    if (drop) pin(drop, 'B', token('--series-2'));
  }, [pickup, drop]);

  // ---- routes --------------------------------------------------------------
  useEffect(() => {
    const layer = routeLayer.current;
    const m = map.current;
    if (!layer || !m) return;
    layer.clearLayers();

    if (routes.length === 0) return;

    // Alternatives first so the selected line is painted over them.
    const ordered = [...routes].sort((a) =>
      a.profile === selectedProfile ? 1 : -1,
    );

    for (const r of ordered) {
      const line = r.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
      if (line.length < 2) continue;

      const active = r.profile === selectedProfile;
      L.polyline(line, {
        color: active ? token('--series-1') : token('--mist-400'),
        weight: active ? 6 : 2.5,
        opacity: active ? 0.95 : 0.35,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layer);
    }

    const selected = routes.find((r) => r.profile === selectedProfile) ?? routes[0]!;
    const bounds = L.latLngBounds(
      selected.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
    );
    if (bounds.isValid()) m.fitBounds(bounds, { padding: [48, 48], maxZoom: 16 });
  }, [routes, selectedProfile]);

  // ---- vehicles and charging stations --------------------------------------
  useEffect(() => {
    const layer = poiLayer.current;
    if (!layer) return;
    layer.clearLayers();

    for (const v of vehicles) {
      const colour = token(`--line-${v.type}`) || token('--mist-100');
      const battery = v.batteryPct === null ? '—' : `${Math.round(v.batteryPct)}%`;

      L.circleMarker([v.location[1], v.location[0]], {
        radius: 6,
        color: '#0b1220',
        weight: 1.5,
        fillColor: colour,
        fillOpacity: 1,
      })
        .bindTooltip(
          `${v.externalRef} · ${v.type} · ${battery}` +
            (v.rangeM > 0 ? ` · ~${(v.rangeM / 1000).toFixed(0)} km range` : '') +
            ` · ${v.distanceM} m away`,
          { direction: 'top' },
        )
        .addTo(layer);
    }

    for (const s of stations) {
      L.marker([s.location[1], s.location[0]], {
        icon: L.divIcon({
          className: '',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
          html: `<div style="
            width:20px;height:20px;border-radius:6px;background:${token('--warn')};
            border:2px solid #0b1220;display:flex;align-items:center;justify-content:center;
            font:700 12px/1 system-ui;color:#0b1220">⚡</div>`,
        }),
      })
        .bindTooltip(
          `${s.name} · ${s.connectors} points · ${s.powerKw} kW` +
            (s.distanceM !== undefined ? ` · ${s.distanceM} m from route` : ''),
          { direction: 'top' },
        )
        .addTo(layer);
    }
  }, [vehicles, stations]);

  return (
    <Box className="relative h-full w-full">
      <div ref={container} className="absolute inset-0" data-testid="route-map" />

      {!pickup && (
        <Box className="pointer-events-none absolute left-1/2 top-3 z-[500] -translate-x-1/2 rounded-md border border-ink-700 bg-ink-900 px-3 py-1.5">
          <Typography variant="caption" color="text.secondary">
            Click the map to drop your pickup pin
          </Typography>
        </Box>
      )}

      {pickup && !drop && (
        <Box className="pointer-events-none absolute left-1/2 top-3 z-[500] -translate-x-1/2 rounded-md border border-ink-700 bg-ink-900 px-3 py-1.5">
          <Typography variant="caption" color="text.secondary">
            Now click your destination
          </Typography>
        </Box>
      )}

      {tilesFailed && (
        <Box className="pointer-events-none absolute bottom-8 left-1/2 z-[500] -translate-x-1/2 rounded-md border border-ink-700 bg-ink-900 px-3 py-1.5">
          <Typography variant="caption" color="text.secondary">
            Street tiles unavailable — the route and pins still work.
          </Typography>
        </Box>
      )}
    </Box>
  );
}
