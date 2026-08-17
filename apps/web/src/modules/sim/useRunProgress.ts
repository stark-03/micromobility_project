import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RunCompletedEvent, RunProgressEvent } from '@mm/shared-types';
import { getSocket } from '../../lib/use-realtime.ts';

/**
 * Live progress for one run.
 *
 * Joins `run:<id>`, which the gateway authorises server-side against the user's
 * roles — the room name is never trusted from the client. On completion the
 * run's queries are invalidated so the results render without a manual refresh.
 *
 * Returns null when nothing is being watched. The caller must still handle the
 * socket being unavailable: the run row carries `progress` and `status`, so
 * polling shows the same thing more slowly, and nothing on screen depends on
 * the socket being up.
 */
export function useRunProgress(runId: string | null): RunProgressEvent | null {
  const [progress, setProgress] = useState<RunProgressEvent | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    setProgress(null);
    if (!runId) return;

    const socket = getSocket();
    if (!socket) return;

    const room = `run:${runId}`;
    socket.emit('subscribe', room);

    const onProgress = (event: RunProgressEvent) => {
      if (event.runId === runId) setProgress(event);
    };
    const onCompleted = (event: RunCompletedEvent) => {
      if (event.runId !== runId) return;
      setProgress(null);
      void queryClient.invalidateQueries({ queryKey: ['sim'] });
    };

    socket.on('run:progress', onProgress);
    socket.on('run:completed', onCompleted);

    return () => {
      socket.emit('unsubscribe', room);
      socket.off('run:progress', onProgress);
      socket.off('run:completed', onCompleted);
    };
  }, [runId, queryClient]);

  return progress;
}
