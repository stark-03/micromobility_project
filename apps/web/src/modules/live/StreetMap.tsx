import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Box, Typography } from '@mui/material';
import type { SegmentTrafficDto, ZoneDto } from '@mm/shared-types';
import { flowRamp, token } from '../../lib/tokens.ts';

const BELAGAVI_CENTRE: [number, number] = [15.8497, 74.4977]; // Leaflet is [lat, lng]

/**
 * The real Belagavi street map.
 *
 * Leaflet, not MapLibre, and deliberately so. MapLibre needs WebGL, a web
 * worker and a canvas — three independent things that can fail silently and all
 * produce an identical blank rectangle, which is exactly what happened on this
 * machine. Leaflet renders tiles as plain DOM images and vectors to a 2D canvas:
 * no WebGL, no worker, no graphics driver. It works with fingerprint blocking
 * on, and it can be asserted against in a test.
 *
 * The road network underneath comes from OpenStreetMap tiles, so it is the
 * actual city rather than something generated. What we draw on top is only the
 * ~1,700 MONITORED corridors coloured by congestion — which is also how real
 * traffic services work: main roads carry colour, side streets do not.
 *
 * No API key and no billing account. OSM tiles are free under ODbL; the
 * attribution control is required by that licence and must not be removed.
 */

export interface StreetMapProps {
  zones: ZoneDto[];
  segments: SegmentTrafficDto[];
  selectedId?: string | null;
  onSelectSegment?: (segment: SegmentTrafficDto | null) => void;
}

function widthFor(roadClass: string, active: boolean): number {
  const base = roadClass === 'arterial' ? 5 : roadClass === 'collector' ? 3.5 : 2.5;
  return active ? base + 3 : base;
}

export function StreetMap({ zones, segments, selectedId, onSelectSegment }: StreetMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const trafficLayer = useRef<L.LayerGroup | null>(null);
  const zoneLayer = useRef<L.LayerGroup | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);

  const latest = useRef({ segments, onSelectSegment, selectedId });
  latest.current = { segments, onSelectSegment, selectedId };

  // ---- create once ---------------------------------------------------------
  useEffect(() => {
    if (!container.current || map.current) return;

    const m = L.map(container.current, {
      center: BELAGAVI_CENTRE,
      zoom: 13,
      // Vectors to a 2D canvas rather than one SVG node per road: with ~1,700
      // polylines the DOM renderer becomes visibly slow to pan.
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

    zoneLayer.current = L.layerGroup().addTo(m);
    trafficLayer.current = L.layerGroup().addTo(m);

    return () => {
      m.remove();
      map.current = null;
      trafficLayer.current = null;
      zoneLayer.current = null;
    };
  }, []);

  // ---- zone outlines -------------------------------------------------------
  useEffect(() => {
    const layer = zoneLayer.current;
    if (!layer) return;
    layer.clearLayers();

    for (const z of zones) {
      if (!z.boundary) continue;
      // GeoJSON is [lng, lat]; Leaflet wants [lat, lng].
      const ring = z.boundary.coordinates[0]!.map(
        ([lng, lat]) => [lat, lng] as [number, number],
      );
      L.polygon(ring, {
        color: token('--mist-400'),
        weight: 1,
        opacity: 0.5,
        fill: false,
        dashArray: '4 6',
        interactive: false,
      }).addTo(layer);

      L.marker([z.centroid.coordinates[1], z.centroid.coordinates[0]], {
        interactive: false,
        icon: L.divIcon({
          className: '',
          html: `<span style="font-family:var(--font-display);font-size:11px;letter-spacing:.08em;
                 color:var(--mist-100);text-shadow:0 0 4px var(--ink-950),0 0 8px var(--ink-950);
                 white-space:nowrap">${z.name.toUpperCase()}</span>`,
        }),
      }).addTo(layer);
    }
  }, [zones]);

  // ---- congestion overlay --------------------------------------------------
  useEffect(() => {
    const layer = trafficLayer.current;
    if (!layer) return;
    layer.clearLayers();

    const ramp = flowRamp();

    for (const s of segments) {
      const line = s.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
      if (line.length < 2) continue;

      const active = selectedId === s.segmentId;
      const polyline = L.polyline(line, {
        color: ramp[s.flowBand] ?? token('--mist-400'),
        weight: widthFor(s.roadClass, active),
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
      });

      polyline.on('click', () => {
        latest.current.onSelectSegment?.(s);
      });
      polyline.bindTooltip(
        `${s.name ?? `Segment ${s.segmentId}`} · ${(s.congestionIndex * 100).toFixed(0)}% congested`,
        { sticky: true },
      );

      polyline.addTo(layer);
    }
  }, [segments, selectedId]);

  return (
    <Box className="absolute inset-0">
      <div ref={container} className="absolute inset-0" data-testid="street-map" />
      {tilesFailed && (
        <Box className="pointer-events-none absolute left-1/2 top-3 z-[500] -translate-x-1/2 rounded-md border border-ink-700 bg-ink-900 px-3 py-1.5">
          <Typography variant="caption" color="text.secondary">
            Street tiles unavailable — congestion overlay still live. Switch to the offline map if
            this persists.
          </Typography>
        </Box>
      )}
    </Box>
  );
}
