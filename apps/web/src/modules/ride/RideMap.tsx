import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Box, Typography } from '@mui/material';
import type { LngLat, RentalStationDto } from '@mm/shared-types';
import { token } from '../../lib/tokens.ts';

const BELAGAVI: [number, number] = [15.8497, 74.4977]; // Leaflet is [lat, lng]

export interface ChargerPin {
  id: string;
  name: string;
  location: LngLat;
  connectors: number;
  powerKw: number;
  distanceM?: number;
}

export interface RideMapProps {
  origin: LngLat | null;
  destination: LngLat | null;
  stations: RentalStationDto[];
  chargers: ChargerPin[];
  selectedStationId: string | null;
  /** The live GPS trace of the ride in progress. */
  ridePath: LngLat[];
  /** Where the vehicle is now, while riding. */
  vehicleAt: LngLat | null;
  /** A planned line to follow, drawn dashed — the simulated route. */
  plannedPath: LngLat[];
  /** Map clicks set the rider's location only while nothing is being ridden. */
  onPick?: (point: LngLat) => void;
  onSelectStation?: (id: string) => void;
}

const ll = (p: LngLat): [number, number] => [p[1], p[0]];

/**
 * The Ride map. Same Leaflet setup as the Plan map, for the same reasons
 * (no WebGL, nothing that fails to a blank rectangle).
 *
 * Station markers carry their rentable count, so a rider scanning the map can
 * see where vehicles are without opening each one; an empty station is drawn
 * hollow, which is the cue to look for an alternative.
 */
export function RideMap({
  origin,
  destination,
  stations,
  chargers,
  selectedStationId,
  ridePath,
  vehicleAt,
  plannedPath,
  onPick,
  onSelectStation,
}: RideMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const stationLayer = useRef<L.LayerGroup | null>(null);
  const rideLayer = useRef<L.LayerGroup | null>(null);
  const pinLayer = useRef<L.LayerGroup | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const fittedRide = useRef(false);

  const latest = useRef({ onPick, onSelectStation });
  latest.current = { onPick, onSelectStation };

  useEffect(() => {
    if (!container.current || map.current) return;
    // SVG, not canvas: this map draws a few dozen shapes, not the Plan map's
    // thousands, and SVG has no deferred redraw to fire into a torn-down map
    // when the rider navigates away mid-ride.
    const m = L.map(container.current, { center: BELAGAVI, zoom: 14, renderer: L.svg() });
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

    rideLayer.current = L.layerGroup().addTo(m);
    stationLayer.current = L.layerGroup().addTo(m);
    pinLayer.current = L.layerGroup().addTo(m);

    m.on('click', (e: L.LeafletMouseEvent) => {
      latest.current.onPick?.([Number(e.latlng.lng.toFixed(6)), Number(e.latlng.lat.toFixed(6))]);
    });

    // The side panel changes height as a ride starts and ends; Leaflet only
    // measures its container once, and leaves a grey band where it grew.
    const resize = new ResizeObserver(() => m.invalidateSize({ animate: false }));
    resize.observe(container.current);

    return () => {
      resize.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (container.current) container.current.style.cursor = onPick ? 'crosshair' : '';
  }, [onPick]);

  // ---- rider and destination pins ------------------------------------------
  useEffect(() => {
    const layer = pinLayer.current;
    const m = map.current;
    if (!layer || !m) return;
    layer.clearLayers();

    if (origin) {
      L.circleMarker(ll(origin), {
        radius: 8,
        color: '#fff',
        weight: 3,
        fillColor: token('--info') || token('--series-1'),
        fillOpacity: 1,
      })
        .bindTooltip('You are here', { direction: 'top' })
        .addTo(layer);
    }
    if (destination) {
      L.marker(ll(destination), {
        interactive: false,
        icon: L.divIcon({
          className: '',
          iconSize: [26, 26],
          iconAnchor: [13, 26],
          html: `<div style="width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
            background:${token('--series-2')};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.5)"></div>`,
        }),
      }).addTo(layer);
    }
    if (vehicleAt) {
      L.marker(ll(vehicleAt), {
        zIndexOffset: 1000,
        icon: L.divIcon({
          className: '',
          iconSize: [30, 30],
          iconAnchor: [15, 15],
          html: `<div style="width:28px;height:28px;border-radius:50%;background:${token('--ok')};
            border:3px solid #fff;box-shadow:0 0 0 4px rgba(0,0,0,.25);display:flex;align-items:center;
            justify-content:center;font:700 14px/1 system-ui;color:#0b1220">▲</div>`,
        }),
      })
        .bindTooltip('Your vehicle', { direction: 'top' })
        .addTo(layer);
      // Keep the vehicle in view as it moves, without fighting a user who has panned away a little.
      // Not animated: an animation still running when the screen unmounts
      // fires a redraw into a map Leaflet has already torn down.
      if (!m.getBounds().pad(-0.15).contains(ll(vehicleAt)))
        m.panTo(ll(vehicleAt), { animate: false });
    } else if (origin) {
      m.setView(ll(origin), Math.max(m.getZoom(), 15), { animate: false });
    }
  }, [origin, destination, vehicleAt]);

  // ---- stations and chargers -----------------------------------------------
  useEffect(() => {
    const layer = stationLayer.current;
    if (!layer) return;
    layer.clearLayers();

    for (const c of chargers) {
      L.marker(ll(c.location), {
        icon: L.divIcon({
          className: '',
          iconSize: [20, 20],
          iconAnchor: [10, 10],
          html: `<div style="width:18px;height:18px;border-radius:5px;background:${token('--warn')};
            border:2px solid #0b1220;display:flex;align-items:center;justify-content:center;
            font:700 11px/1 system-ui;color:#0b1220">⚡</div>`,
        }),
      })
        .bindTooltip(
          `Charging: ${c.name} · ${c.connectors} points · ${c.powerKw} kW` +
            (c.distanceM !== undefined ? ` · ${c.distanceM} m away` : ''),
          { direction: 'top' },
        )
        .addTo(layer);
    }

    for (const s of stations) {
      const empty = s.rentableTotal === 0;
      const selected = s.id === selectedStationId;
      const colour = token('--series-1');
      const marker = L.marker(ll(s.location), {
        zIndexOffset: selected ? 900 : 500,
        icon: L.divIcon({
          className: '',
          iconSize: [34, 34],
          iconAnchor: [17, 17],
          html: `<div style="width:${selected ? 34 : 30}px;height:${selected ? 34 : 30}px;border-radius:8px;
            background:${empty ? '#0b1220' : colour};border:${selected ? 3 : 2}px solid ${empty ? colour : '#fff'};
            display:flex;align-items:center;justify-content:center;font:700 13px/1 system-ui;
            color:${empty ? colour : '#fff'};box-shadow:0 2px 6px rgba(0,0,0,.45)">${s.rentableTotal}</div>`,
        }),
      })
        .bindTooltip(
          `${s.name} · ${s.rentableTotal} to rent · ${s.freeDocks} free docks` +
            (s.distanceM !== undefined ? ` · ${s.distanceM} m` : ''),
          { direction: 'top' },
        )
        .addTo(layer);
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        latest.current.onSelectStation?.(s.id);
      });
    }
  }, [stations, chargers, selectedStationId]);

  // ---- ride path and planned route -----------------------------------------
  useEffect(() => {
    const layer = rideLayer.current;
    const m = map.current;
    if (!layer || !m) return;
    layer.clearLayers();

    if (plannedPath.length > 1) {
      L.polyline(plannedPath.map(ll), {
        color: token('--mist-400'),
        weight: 4,
        opacity: 0.7,
        dashArray: '6 8',
      }).addTo(layer);
    }
    if (ridePath.length > 1) {
      L.polyline(ridePath.map(ll), {
        color: token('--ok'),
        weight: 6,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(layer);
    }
    // Frame the ride once when it first appears, then leave the view to the rider.
    if (ridePath.length > 0 && !fittedRide.current) {
      fittedRide.current = true;
      m.setView(ll(ridePath[ridePath.length - 1]!), 16, { animate: false });
    }
    if (ridePath.length === 0) fittedRide.current = false;
  }, [ridePath, plannedPath]);

  return (
    <Box className="relative h-full w-full">
      <div ref={container} className="absolute inset-0" data-testid="ride-map" />
      {tilesFailed && (
        <Box className="pointer-events-none absolute bottom-8 left-1/2 z-[500] -translate-x-1/2 rounded-md border border-ink-700 bg-ink-900 px-3 py-1.5">
          <Typography variant="caption" color="text.secondary">
            Street tiles unavailable — stations and your ride still show.
          </Typography>
        </Box>
      )}
    </Box>
  );
}
