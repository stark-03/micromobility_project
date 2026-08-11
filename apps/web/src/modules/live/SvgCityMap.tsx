import { useMemo, useState } from 'react';
import { Box } from '@mui/material';
import type { LngLat, SegmentTrafficDto, ZoneDto } from '@mm/shared-types';
import { flowRamp, token } from '../../lib/tokens.ts';

/**
 * The city, drawn as SVG.
 *
 * This is the primary renderer, not a fallback. MapLibre needs WebGL, a web
 * worker and a canvas — three independent things that can fail silently and
 * produce an identical blank rectangle, which is exactly what happened here.
 * SVG needs none of them: it renders in every browser, survives Brave's
 * fingerprint blocking, works with no network at all, and can be asserted
 * against in a test rather than eyeballed.
 *
 * It is also what design.md §6.1 actually asks for — "the city is drawn as a
 * network of lines". The trade-off is no free pan/zoom and no street basemap;
 * those live behind the MapLibre view for when they are wanted.
 */

const PAD = 0.06; // fraction of the bbox kept as margin
const VIEW_W = 1000;
const VIEW_H = 700;

interface Projection {
  toXY: (c: LngLat) => [number, number];
}

function projectionFor(zones: ZoneDto[], segments: SegmentTrafficDto[]): Projection {
  const lngs: number[] = [];
  const lats: number[] = [];

  for (const z of zones) {
    for (const ring of z.boundary?.coordinates ?? []) {
      for (const [lng, lat] of ring) {
        lngs.push(lng);
        lats.push(lat);
      }
    }
  }
  for (const s of segments) {
    for (const [lng, lat] of s.geometry.coordinates) {
      lngs.push(lng);
      lats.push(lat);
    }
  }

  // Nothing to draw — a degenerate projection is fine, the caller renders an
  // empty state anyway.
  if (lngs.length === 0) {
    return { toXY: () => [VIEW_W / 2, VIEW_H / 2] };
  }

  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);

  const spanLng = Math.max(maxLng - minLng, 1e-6);
  const spanLat = Math.max(maxLat - minLat, 1e-6);

  // Equirectangular, corrected for latitude so Belagavi is not stretched
  // east-west. At 15.8°N cos(lat) ≈ 0.962, so the correction is small but the
  // road grid would visibly skew without it.
  const latRad = (((minLat + maxLat) / 2) * Math.PI) / 180;
  const aspectCorrection = Math.cos(latRad);
  const effectiveSpanLng = spanLng * aspectCorrection;

  // Fit while preserving shape: one scale for both axes.
  const usableW = VIEW_W * (1 - 2 * PAD);
  const usableH = VIEW_H * (1 - 2 * PAD);
  const scale = Math.min(usableW / effectiveSpanLng, usableH / spanLat);

  const drawnW = effectiveSpanLng * scale;
  const drawnH = spanLat * scale;
  const offsetX = (VIEW_W - drawnW) / 2;
  const offsetY = (VIEW_H - drawnH) / 2;

  return {
    toXY: ([lng, lat]) => [
      offsetX + (lng - minLng) * aspectCorrection * scale,
      // SVG y grows downward; latitude grows upward.
      offsetY + (maxLat - lat) * scale,
    ],
  };
}

/** Arterials read as the skeleton of the city; paths are hairlines. */
const WIDTH_BY_CLASS: Record<string, number> = {
  arterial: 4,
  collector: 3,
  local: 2,
  cycleway: 1.6,
  path: 1.2,
};

export interface SvgCityMapProps {
  zones: ZoneDto[];
  segments: SegmentTrafficDto[];
  selectedId?: string | null;
  onSelectSegment?: (segment: SegmentTrafficDto | null) => void;
}

export function SvgCityMap({
  zones,
  segments,
  selectedId,
  onSelectSegment,
}: SvgCityMapProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const ramp = flowRamp();
  const inkGrey = token('--ink-700');
  const inkZone = token('--ink-800');
  const mist = token('--mist-400');

  const projection = useMemo(() => projectionFor(zones, segments), [zones, segments]);

  const zonePaths = useMemo(
    () =>
      zones
        .filter((z) => z.boundary !== null)
        .map((z) => {
          const ring = z.boundary!.coordinates[0] ?? [];
          const d =
            ring
              .map((c, i) => {
                const [x, y] = projection.toXY(c);
                return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
              })
              .join(' ') + ' Z';
          const [cx, cy] = projection.toXY(z.centroid.coordinates);
          return { id: z.id, name: z.name, d, cx, cy };
        }),
    [zones, projection],
  );

  const segmentPaths = useMemo(
    () =>
      segments.map((s) => {
        const d = s.geometry.coordinates
          .map((c, i) => {
            const [x, y] = projection.toXY(c);
            return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ');
        return {
          id: s.segmentId,
          d,
          // A segment with no readings is grey, never green — "unmonitored"
          // must not read as "clear".
          stroke: s.computedAt === null ? inkGrey : (ramp[s.flowBand] ?? inkGrey),
          width: WIDTH_BY_CLASS[s.roadClass] ?? 2,
          segment: s,
        };
      }),
    [segments, projection, ramp, inkGrey],
  );

  return (
    <Box className="absolute inset-0 overflow-hidden">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        role="img"
        aria-label={`Belagavi traffic map, ${segments.length} road segments across ${zones.length} zones`}
        data-testid="svg-city-map"
      >
        <g data-testid="zones">
          {zonePaths.map((z) => (
            <path
              key={z.id}
              d={z.d}
              fill={inkZone}
              fillOpacity={0.35}
              stroke={inkGrey}
              strokeWidth={1}
            />
          ))}
        </g>

        <g data-testid="segments">
          {segmentPaths.map((s) => {
            const active = selectedId === s.id || hovered === s.id;
            return (
              <path
                key={s.id}
                data-segment-id={s.id}
                d={s.d}
                fill="none"
                stroke={s.stroke}
                strokeWidth={active ? s.width + 3 : s.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.95}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHovered(s.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelectSegment?.(s.segment)}
              />
            );
          })}
        </g>

        {/* Zone labels last, so they sit above the road network. */}
        <g data-testid="zone-labels" pointerEvents="none">
          {zonePaths.map((z) => (
            <text
              key={z.id}
              x={z.cx}
              y={z.cy}
              fill={mist}
              fontSize={13}
              textAnchor="middle"
              style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.08em' }}
            >
              {z.name.toUpperCase()}
            </text>
          ))}
        </g>
      </svg>
    </Box>
  );
}
