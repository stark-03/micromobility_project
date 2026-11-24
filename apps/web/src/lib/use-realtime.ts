import { useEffect } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { authSnapshot, useAuthStore } from './auth-store.ts';

let socket: Socket | null = null;

/** Whether live updates are arriving, for the "Live" dot on screens that use them. */
export const useRealtimeStatus = create<{ connected: boolean }>(() => ({ connected: false }));

/**
 * A rider sends a position every second or so; the fleet list does not need
 * refetching that often. Coalesced, so one screen spends about 20 of its 100
 * requests a minute on this.
 */
const POSITION_REFRESH_MS = 3000;

/**
 * One shared socket for the whole app.
 *
 * The server pushes `traffic:update` when the snapshot worker finishes, and we
 * invalidate the precise query key rather than refetching everything — the
 * CLAUDE.md rule that mutations invalidate precise keys, not the whole cache.
 *
 * The Live screen also polls on a 15 s interval. That is deliberate belt and
 * braces: if the socket cannot connect, the map still updates, just less
 * promptly. Nothing on screen depends on the socket being up.
 */
export function useRealtime(): void {
  const accessToken = useAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!accessToken) return;

    socket ??= io({
      path: '/socket.io',
      // A function, so a reconnect presents the current token. The one from
      // sign-in lasts 15 minutes; after that the server would refuse it.
      auth: (cb) => cb({ token: authSnapshot().accessToken }),
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });

    const s = socket;

    const onTraffic = () => {
      void queryClient.invalidateQueries({ queryKey: ['traffic', 'live'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics', 'kpis'] });
    };
    const onWeather = () => {
      void queryClient.invalidateQueries({ queryKey: ['weather', 'current'] });
    };
    const onVehicle = () => {
      void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    };
    let positionTimer: ReturnType<typeof setTimeout> | null = null;
    const onPosition = () => {
      positionTimer ??= setTimeout(() => {
        positionTimer = null;
        void queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      }, POSITION_REFRESH_MS);
    };
    const onStations = () => {
      void queryClient.invalidateQueries({ queryKey: ['stations'] });
    };
    const onConnect = () => useRealtimeStatus.setState({ connected: true });
    const onDisconnect = () => useRealtimeStatus.setState({ connected: false });
    if (s.connected) onConnect();

    s.on('traffic:update', onTraffic);
    s.on('weather:update', onWeather);
    s.on('vehicle:status', onVehicle);
    s.on('vehicle:position', onPosition);
    s.on('stations:changed', onStations);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);

    return () => {
      s.off('traffic:update', onTraffic);
      s.off('weather:update', onWeather);
      s.off('vehicle:status', onVehicle);
      s.off('vehicle:position', onPosition);
      s.off('stations:changed', onStations);
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      if (positionTimer) clearTimeout(positionTimer);
    };
  }, [accessToken, queryClient]);
}

export function disconnectRealtime(): void {
  socket?.disconnect();
  socket = null;
  useRealtimeStatus.setState({ connected: false });
}

/**
 * The shared socket, for screens that need a room rather than the app-wide
 * events above.
 *
 * Returns null before sign-in, when there is no socket to join with. Callers
 * must treat that as "no live updates" and fall back to polling — the server
 * authorises room joins against the user's roles, so a room subscription is
 * never guaranteed to succeed either.
 */
export function getSocket(): Socket | null {
  return socket;
}
