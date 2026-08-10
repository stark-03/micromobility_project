import { useEffect, useRef } from 'react';
// maplibre-gl v6 is ESM with no default export — named imports only.
import { Map as MapLibreMap, NavigationControl, ScaleControl } from 'maplibre-gl';
import type {
  GeoJSONSource,
  LineLayerSpecification,
  MapLayerMouseEvent,
  StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
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
  const onSelect = useRef(onSelectSegment);
  onSelect.current = onSelectSegment;

  // ---- create once ---------------------------------------------------------
  useEffect(() => {
    if (!container.current || map.current) return;

    const m = new MapLibreMap({
      container: container.current,
      style: baseStyle(),
      center: BELAGAVI_CENTRE,
      zoom: 12.4,
      attributionControl: false,
    });
    map.current = m;

    m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right');

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
        const f = e.features?.[0];
        onSelect.current?.(
          f
            ? (segments.find((s) => s.segmentId === String(f.properties?.segmentId)) ?? null)
            : null,
        );
      });
      m.on('mouseenter', 'segment-hit', () => {
        m.getCanvas().style.cursor = 'pointer';
      });
      m.on('mouseleave', 'segment-hit', () => {
        m.getCanvas().style.cursor = '';
      });

      ready.current = true;
    });

    return () => {
      ready.current = false;
      m.remove();
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

  return <div ref={container} className="h-full w-full" />;
}
