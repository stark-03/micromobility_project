import { useEffect, useRef, useState } from 'react';
// maplibre-gl v6 is ESM with no default export — named imports only.
import { Map as MapLibreMap, NavigationControl, ScaleControl } from 'maplibre-gl';
import type {
  GeoJSONSource,
  LineLayerSpecification,
  MapLayerMouseEvent,
  StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Box, Typography } from '@mui/material';
import type { SegmentTrafficDto, ZoneDto } from '@mm/shared-types';
import { flowRamp, token } from '../../lib/tokens.ts';

const BELAGAVI_CENTRE: [number, number] = [74.4977, 15.8497];

/**
 * Offline style: no external tile server at all.
 *
 * The city is drawn entirely from our own seeded geometry, on the ink
 * background — which is also what design.md §6.1 asks for ("the city is drawn
 * as a network of lines"). Nothing here can fail because campus wifi dropped
 * mid-demo. The OSM basemap is opt-in on top.
 */
function baseStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': token('--ink-950') } }],
  };
}

const OSM_SOURCE = 'osm-raster';
const OSM_LAYER = 'osm-raster-layer';

export interface CityMapProps {
  zones: ZoneDto[];
  segments: SegmentTrafficDto[];
  basemap: boolean;
  onSelectSegment?: (segment: SegmentTrafficDto | null) => void;
}

function zonesToGeoJson(zones: ZoneDto[]) {
  return {
    type: 'FeatureCollection' as const,
    features: zones
      .filter((z) => z.boundary !== null)
      .map((z) => ({
        type: 'Feature' as const,
        id: Number(z.id),
        properties: { code: z.code, name: z.name },
        geometry: z.boundary!,
      })),
  };
}

function segmentsToGeoJson(segments: SegmentTrafficDto[]) {
  return {
    type: 'FeatureCollection' as const,
    features: segments.map((s) => ({
      type: 'Feature' as const,
      id: Number(s.segmentId),
      properties: {
        segmentId: s.segmentId,
        name: s.name ?? '',
        flowBand: s.flowBand,
        congestion: s.congestionIndex,
        roadClass: s.roadClass,
        meanSpeedKph: s.meanSpeedKph,
        measured: s.computedAt !== null ? 1 : 0,
      },
      geometry: s.geometry,
    })),
  };
}

export function CityMap({ zones, segments, basemap, onSelectSegment }: CityMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Latest props, read from inside long-lived MapLibre handlers. Without this
  // the click handler closes over the segment list as it was when the map was
  // created — the empty array — so every click selected nothing.
  const latest = useRef({ segments, onSelectSegment });
  latest.current = { segments, onSelectSegment };

  // ---- create once ---------------------------------------------------------
  useEffect(() => {
    if (!container.current || map.current) return;

    let m: MapLibreMap;
    try {
      m = new MapLibreMap({
        container: container.current,
        style: baseStyle(),
        center: BELAGAVI_CENTRE,
        zoom: 12.4,
        attributionControl: false,
      });
    } catch (e) {
      // Usually WebGL being unavailable. Say so rather than showing a void.
      setFailure(e instanceof Error ? e.message : String(e));
      return;
    }
    map.current = m;

    // MapLibre logs errors to the console and carries on, so a bad layer or a
    // dead tile host just reads as "the map is blank". Surface it instead.
    m.on('error', (e: { error?: Error }) => {
      const message = e.error?.message ?? 'Unknown MapLibre error';
      // A failed basemap tile is not fatal — our own data still renders.
      if (/tile|raster|openstreetmap/i.test(message)) return;
      setFailure(message);
    });

    // Register the load handler BEFORE anything else that could throw.
    //
    // This ordering is the whole ballgame. ScaleControl throws if the map has
    // no measurable size when it is added — which happens whenever the
    // container is still 0x0 at construction. With the controls added first,
    // that exception aborted the rest of this effect, so `m.on('load')` was
    // never attached, no sources or layers were ever created, and the map sat
    // permanently blank behind a single console error. Data first, chrome
    // second.
    m.on('load', () => {
      const ramp = flowRamp();

      m.addSource('zones', { type: 'geojson', data: zonesToGeoJson([]) });
      m.addLayer({
        id: 'zone-fill',
        type: 'fill',
        source: 'zones',
        paint: { 'fill-color': token('--ink-800'), 'fill-opacity': 0.35 },
      });
      m.addLayer({
        id: 'zone-outline',
        type: 'line',
        source: 'zones',
        paint: { 'line-color': token('--ink-700'), 'line-width': 1 },
      });

      m.addSource('segments', { type: 'geojson', data: segmentsToGeoJson([]) });

      // A wide transparent line under the visible one, so a 2px road is still
      // easy to click.
      m.addLayer({
        id: 'segment-hit',
        type: 'line',
        source: 'segments',
        paint: { 'line-color': token('--ink-950'), 'line-opacity': 0, 'line-width': 14 },
      });

      const flowColour: LineLayerSpecification['paint'] = {
        'line-color': [
          'case',
          ['==', ['get', 'measured'], 0],
          token('--ink-700'), // never measured — grey, not green
          [
            'match',
            ['get', 'flowBand'],
            0, ramp[0],
            1, ramp[1],
            2, ramp[2],
            3, ramp[3],
            4, ramp[4],
            token('--ink-700'),
          ],
        ],
        'line-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          11, ['match', ['get', 'roadClass'], 'arterial', 2.5, 'collector', 2, 1.2],
          15, ['match', ['get', 'roadClass'], 'arterial', 7, 'collector', 5, 3],
        ],
        'line-opacity': 0.95,
      };

      m.addLayer({
        id: 'segment-line',
        type: 'line',
        source: 'segments',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: flowColour,
      });

      m.on('click', 'segment-hit', (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.segmentId;
        const { segments: current, onSelectSegment: cb } = latest.current;
        cb?.(current.find((s) => s.segmentId === String(id)) ?? null);
      });
      m.on('mouseenter', 'segment-hit', () => {
        m.getCanvas().style.cursor = 'pointer';
      });
      m.on('mouseleave', 'segment-hit', () => {
        m.getCanvas().style.cursor = '';
      });

      ready.current = true;
      // If the container was still being laid out when the map was built, the
      // canvas is 0x0 and nothing draws. One explicit resize settles it.
      m.resize();

      // Chrome last, and non-fatally: a control that cannot measure the map
      // must never cost us the layers we just added.
      try {
        m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
        m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right');
      } catch {
        // Zoom buttons and a scale bar are a convenience; the city is the point.
      }
    });

    // Belt and braces for the same problem: the container gaining height after
    // mount, or the context panel changing the available width.
    //
    // Guarded for the same reason the controls are: this effect must never be
    // abandoned part-way by something incidental to drawing the city.
    let observer: ResizeObserver | null = null;
    try {
      observer = new ResizeObserver(() => {
        m.resize();
      });
      observer.observe(container.current);
    } catch {
      observer = null;
    }

    return () => {
      observer?.disconnect();
      ready.current = false;
      try {
        // Throws if the map never finished initialising — which happens for
        // real if the user navigates away from /live before it loads.
        // Unmounting must not take the app down with it.
        m.remove();
      } catch {
        /* already gone */
      }
      map.current = null;
    };
    // Deliberately empty: the map instance is created once and torn down on
    // unmount. Data and the basemap toggle arrive through the effects below,
    // which mutate sources rather than rebuilding the map.
  }, []);

  // ---- push data on every change ------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      (m.getSource('zones') as GeoJSONSource | undefined)?.setData(
        zonesToGeoJson(zones),
      );
      (m.getSource('segments') as GeoJSONSource | undefined)?.setData(
        segmentsToGeoJson(segments),
      );
    };
    if (ready.current) apply();
    else m.once('load', apply);
  }, [zones, segments]);

  // ---- basemap toggle ------------------------------------------------------
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    const apply = () => {
      const has = Boolean(m.getLayer(OSM_LAYER));
      if (basemap && !has) {
        m.addSource(OSM_SOURCE, {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors',
        });
        // Beneath the zone fill, so our own data still reads on top.
        m.addLayer(
          { id: OSM_LAYER, type: 'raster', source: OSM_SOURCE, paint: { 'raster-opacity': 0.55 } },
          'zone-fill',
        );
      } else if (!basemap && has) {
        m.removeLayer(OSM_LAYER);
        m.removeSource(OSM_SOURCE);
      }
    };

    if (ready.current) apply();
    else m.once('load', apply);
  }, [basemap]);

  return (
    // absolute inset-0, not h-full: `height: 100%` on a child of a flex item
    // depends on that item resolving a definite height, which is exactly the
    // kind of thing that silently collapses to zero and leaves a blank canvas.
    // Filling a positioned parent removes the question entirely.
    <Box className="absolute inset-0">
      <div ref={container} className="absolute inset-0" />
      {failure && (
        <Box className="absolute inset-x-0 top-0 z-20 border-b border-ink-700 bg-ink-900 px-4 py-2">
          <Typography variant="overline" sx={{ color: 'var(--danger)' }}>
            Map error
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {failure}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
