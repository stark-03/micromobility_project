import { useState } from 'react';
import { create } from 'zustand';
import { Box, Button, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import type L from 'leaflet';
import type { LngLat } from '@mm/shared-types';

/**
 * Which map is under the app: the free OpenStreetMap one, or Google's.
 *
 * Google's own map, with our routes and stations drawn on it, needs a Google
 * Maps Platform API key, and Google issues those only to projects with a
 * billing account. Without one, Google allows its embedded map (the same as
 * "Share → Embed a map" on google.com/maps), which shows a place but cannot
 * carry our drawings. So the Google view here is for checking where things
 * are against Google; the app's features stay on the OpenStreetMap view.
 */
export type MapSource = 'osm' | 'google';

const STORAGE_KEY = 'mm.mapSource';

function readSaved(): MapSource {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'google' ? 'google' : 'osm';
  } catch {
    return 'osm';
  }
}

/** Remembered per browser, so a reviewer who prefers Google stays on it across screens. */
export const useMapSource = create<{ source: MapSource; setSource: (s: MapSource) => void }>(
  (set) => ({
    source: readSaved(),
    setSource: (source) => {
      try {
        localStorage.setItem(STORAGE_KEY, source);
      } catch {
        // Private windows can refuse storage; the choice just won't be remembered.
      }
      set({ source });
    },
  }),
);

/** Google's embedded map of a spot. `pin` drops Google's own marker on it. */
export function googleEmbedUrl(center: LngLat, zoom: number, pin: boolean): string {
  const at = `${center[1].toFixed(6)},${center[0].toFixed(6)}`;
  const z = Math.max(3, Math.min(20, Math.round(zoom)));
  return pin
    ? `https://maps.google.com/maps?q=${at}&z=${z}&hl=en&output=embed`
    : `https://maps.google.com/maps?ll=${at}&z=${z}&hl=en&output=embed`;
}

const ll = (p: LngLat) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`;

/**
 * Google's own route between two points, in its keyless embed. Google draws
 * the line and its distance and time, which a reviewer can set beside ours.
 */
export function googleDirectionsEmbedUrl(from: LngLat, to: LngLat): string {
  return `https://maps.google.com/maps?saddr=${ll(from)}&daddr=${ll(to)}&hl=en&output=embed`;
}

/** The same trip in the Google Maps website or app (documented, keyless Maps URL). */
export function googleDirectionsLink(from: LngLat, to: LngLat): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${ll(from)}&destination=${ll(to)}&travelmode=two-wheeler`;
}

/** The same spot in the Google Maps website or app. Google's documented, keyless Maps URL. */
export function googleMapsLink(point: LngLat): string {
  return `https://www.google.com/maps/search/?api=1&query=${point[1].toFixed(6)},${point[0].toFixed(6)}`;
}

/**
 * Wraps a Leaflet map with the OpenStreetMap / Google switch.
 *
 * The Google layer sits above z-index 1000, where Leaflet puts its own
 * controls; below that, the free map's zoom buttons and attribution showed
 * through and covered the Google view's buttons.
 *
 * The Leaflet map stays mounted underneath while Google is shown, so switching
 * back restores exactly the view, pins and route the user had.
 */
export function MapSourceFrame({
  map,
  focus,
  focusLabel,
  trip,
  children,
}: {
  /** The Leaflet map, read when switching to Google to centre it on the same view. */
  map: React.RefObject<L.Map | null>;
  /** The point that matters on this screen (a pickup, a selected station), if any. */
  focus?: LngLat | null;
  focusLabel?: string;
  /**
   * A trip the screen shows a route for. Google then draws ITS route between
   * the same two points, with its distance, so the two can be compared.
   */
  trip?: { from: LngLat; to: LngLat; ourDistanceM?: number | null } | null;
  children: React.ReactNode;
}) {
  const { source, setSource } = useMapSource();
  // The view at the moment Google was chosen. Leaflet is hidden meanwhile, so it cannot move.
  const [view, setView] = useState<{ center: LngLat; zoom: number } | null>(null);

  function captureView(): { center: LngLat; zoom: number } {
    const m = map.current;
    if (!m) return { center: focus ?? [74.5077, 15.8497], zoom: 14 };
    const c = m.getCenter();
    return { center: [c.lng, c.lat], zoom: m.getZoom() };
  }

  function choose(next: MapSource | null) {
    if (!next || next === source) return;
    if (next === 'google') setView(captureView());
    setSource(next);
  }

  const google = source === 'google';
  const shown = google ? (view ?? captureView()) : null;
  // A chosen point is what a reviewer wants to check, so Google centres and pins it.
  const center = focus ?? shown?.center ?? null;

  return (
    <Box className="relative h-full w-full">
      {children}

      {google && center && shown && (
        <Box className="absolute inset-0 z-[1100] flex flex-col bg-ink-950">
          <iframe
            key={
              trip
                ? `trip:${ll(trip.from)}:${ll(trip.to)}`
                : `${center[0]},${center[1]},${shown.zoom},${Boolean(focus)}`
            }
            title="Google Maps"
            src={
              trip
                ? googleDirectionsEmbedUrl(trip.from, trip.to)
                : googleEmbedUrl(
                    center,
                    focus ? Math.max(shown.zoom, 16) : shown.zoom,
                    Boolean(focus),
                  )
            }
            className="w-full flex-1 border-0"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
          <Box className="flex flex-wrap items-center gap-2 border-t border-ink-700 bg-ink-900 px-3 py-2">
            <Typography variant="caption" color="text.secondary" className="min-w-0 flex-1">
              {trip ? (
                <>
                  Google's own route between your two points, with Google's distance on the map
                  {trip.ourDistanceM
                    ? `. Ours is ${(trip.ourDistanceM / 1000).toFixed(2)} km on the free map.`
                    : '.'}
                </>
              ) : (
                <>
                  Google's map, for checking positions
                  {focus ? ` — pinned at ${focusLabel ?? 'your selected point'}` : ''}. Routes,
                  stations and vehicles appear on the free map.
                </>
              )}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              href={trip ? googleDirectionsLink(trip.from, trip.to) : googleMapsLink(center)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Google Maps
            </Button>
          </Box>
        </Box>
      )}

      <ToggleButtonGroup
        exclusive
        size="small"
        value={source}
        onChange={(_e, v: MapSource | null) => choose(v)}
        aria-label="Map"
        className="absolute right-3 top-3 z-[1200]"
        sx={{ background: 'var(--ink-900)', boxShadow: 'var(--shadow-card)' }}
      >
        <ToggleButton value="osm" sx={{ px: 1.5, textTransform: 'none' }}>
          Free map
        </ToggleButton>
        <ToggleButton value="google" sx={{ px: 1.5, textTransform: 'none' }}>
          Google
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
}
