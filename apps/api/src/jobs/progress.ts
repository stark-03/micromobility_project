import { isMainThread, parentPort } from 'node:worker_threads';
import { bus } from '../realtime/bus.ts';
import type { BusEvent, BusEvents } from '../realtime/bus.ts';

/**
 * Lets a job publish to the realtime bus from inside a worker thread.
 *
 * This exists because of a seam that is easy to miss and silent when wrong: a
 * worker thread gets its own module registry, so `bus` inside a worker is a
 * *different* EventEmitter than the one the Socket.IO gateway subscribed to on
 * the main thread. A worker calling `bus.emit` directly reaches nobody — no
 * error, no warning, just a progress bar that never moves.
 *
 * So a worker posts over the thread's message channel instead, and the inline
 * driver re-emits on the real bus. On the main thread it publishes directly,
 * which keeps callers from having to know where they are running.
 *
 * This is the same shape a Redis pub/sub adapter would take, so the eventual
 * BullMQ swap replaces the transport and nothing else.
 */
export interface JobBusMessage<K extends BusEvent = BusEvent> {
  kind: 'bus';
  event: K;
  payload: BusEvents[K];
}

export function publish<K extends BusEvent>(event: K, payload: BusEvents[K]): void {
  if (!isMainThread && parentPort) {
    const message: JobBusMessage<K> = { kind: 'bus', event, payload };
    parentPort.postMessage(message);
    return;
  }
  bus.emit(event, payload);
}

export function isJobBusMessage(value: unknown): value is JobBusMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'bus' &&
    typeof (value as { event?: unknown }).event === 'string'
  );
}
