import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LngLat, RentalDto } from '@mm/shared-types';
import { api, ApiClientError } from '../../lib/api.ts';

/** TanStack key for the rider's ride in progress. */
export const ACTIVE_RENTAL_KEY = ['rentals', 'rental', 'active'] as const;

/**
 * Real phones fire watchPosition several times a second when moving. One fix
 * every few seconds is plenty to draw the route and bill the distance, and
 * keeps a 30-minute ride to a few hundred requests rather than thousands.
 */
const MIN_SEND_INTERVAL_MS = 4000;

/** Push the server's view of the ride into the cache, so every panel updates at once. */
function useApplyRental() {
  const qc = useQueryClient();
  return useCallback(
    (rental: RentalDto) => qc.setQueryData(ACTIVE_RENTAL_KEY, { data: rental }),
    [qc],
  );
}

/**
 * Live GPS from the rider's phone.
 *
 * The browser only grants geolocation on HTTPS (or localhost) and only with
 * permission. Both refusals are ordinary, so they come back as a message to
 * show, never as an exception.
 */
export function useGpsTracking(rentalId: string | null, enabled: boolean) {
  const apply = useApplyRental();
  const [error, setError] = useState<string | null>(null);
  const [fixes, setFixes] = useState(0);
  const lastSent = useRef(0);

  useEffect(() => {
    if (!enabled || !rentalId) return;
    if (!navigator.geolocation) {
      setError('This browser has no location support. Use "Simulate ride" instead.');
      return;
    }
    setError(null);

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastSent.current < MIN_SEND_INTERVAL_MS) return;
        lastSent.current = now;
        const position: LngLat = [
          Number(pos.coords.longitude.toFixed(6)),
          Number(pos.coords.latitude.toFixed(6)),
        ];
        api
          .post<RentalDto>(`/rentals/${rentalId}/track`, {
            position,
            speedKph: pos.coords.speed === null ? null : Math.max(0, pos.coords.speed * 3.6),
            accuracyM: pos.coords.accuracy,
            source: 'gps',
          })
          .then((res) => {
            apply(res.data);
            setFixes((n) => n + 1);
          })
          .catch(() => setError('Could not send your position. Retrying with the next fix.'));
      },
      () =>
        setError(
          'Location unavailable — permission denied, or the page is not on HTTPS. Use "Simulate ride" to demo the journey.',
        ),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [rentalId, enabled, apply]);

  return { error, fixes };
}

/** Metres between two [lng, lat] points — only for spacing simulated fixes. */
function metres(a: LngLat, b: LngLat): number {
  const rad = Math.PI / 180;
  const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad);
  const y = (b[1] - a[1]) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/** Points every `stepM` metres along a polyline, ending exactly on its last vertex. */
export function densify(path: LngLat[], stepM: number): LngLat[] {
  if (path.length < 2) return [...path];
  const out: LngLat[] = [path[0]!];
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const len = metres(a, b);
    let at = stepM - carry;
    while (at < len) {
      const t = at / len;
      out.push([
        Number((a[0] + (b[0] - a[0]) * t).toFixed(6)),
        Number((a[1] + (b[1] - a[1]) * t).toFixed(6)),
      ]);
      at += stepM;
    }
    carry = len - (at - stepM);
  }
  const last = path[path.length - 1]!;
  const tail = out[out.length - 1]!;
  if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
  return out;
}

/**
 * 80 m per tick, one tick every 1.2 s: a 3 km ride replays in about 45 seconds.
 *
 * The pace is set by the API's limit of 100 requests a minute (design.md §7),
 * not by what looks smooth. Fifty fixes a minute leaves the other half for the
 * screen's own queries; a faster replay trips the limiter and stalls the ride.
 */
const SIM_STEP_M = 80;
const SIM_TICK_MS = 1200;

/**
 * Replays a ride along a planned route, sending each point as a `simulated`
 * fix. This is the demo path for a laptop with no GPS: the server tracks it
 * exactly as it would a phone, and labels the points so they are never
 * mistaken for a real trace.
 */
export function useSimulatedRide(rentalId: string | null) {
  const apply = useApplyRental();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setRunning(false);
  }, []);

  const start = useCallback(
    (path: LngLat[]) => {
      if (!rentalId || path.length < 2) return;
      stop();
      const points = densify(path, SIM_STEP_M).slice(1);
      let i = 0;
      let inFlight = false;
      setError(null);
      setProgress(0);
      setRunning(true);

      timer.current = setInterval(() => {
        if (inFlight) return; // never queue fixes behind a slow request
        if (i >= points.length) {
          stop();
          return;
        }
        const position = points[i]!;
        inFlight = true;
        api
          .post<RentalDto>(`/rentals/${rentalId}/track`, { position, source: 'simulated' })
          .then((res) => {
            apply(res.data);
            i += 1;
            setProgress(i / points.length);
          })
          .catch((e: unknown) => {
            // Rate limited: hold this point and try it again next tick.
            if (e instanceof ApiClientError && e.code === 'RATE_LIMITED') return;
            setError('The ride simulation lost contact with the server and stopped.');
            stop();
          })
          .finally(() => {
            inFlight = false;
          });
      }, SIM_TICK_MS);
    },
    [rentalId, apply, stop],
  );

  useEffect(() => stop, [stop]);

  return { running, progress, error, start, stop };
}
