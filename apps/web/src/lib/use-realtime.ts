import { useEffect } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from './auth-store.ts';

let socket: Socket | null = null;

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
      auth: { token: accessToken },
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

    s.on('traffic:update', onTraffic);
    s.on('weather:update', onWeather);
    s.on('vehicle:status', onVehicle);

    return () => {
      s.off('traffic:update', onTraffic);
      s.off('weather:update', onWeather);
      s.off('vehicle:status', onVehicle);
    };
  }, [accessToken, queryClient]);
}

export function disconnectRealtime(): void {
  socket?.disconnect();
  socket = null;
}
