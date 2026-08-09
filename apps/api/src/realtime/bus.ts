import { EventEmitter } from 'node:events';
import type { VehicleStatus } from '@mm/shared-types';

/**
 * In-process event bus.
 *
 * This is the seam the Sprint 2 Socket.IO gateway attaches to. Services and
 * workers publish here; only the gateway will ever touch a socket. If the app
 * ever runs on more than one process, this is the single place a Redis pub/sub
 * adapter goes (CLAUDE.md, realtime section).
 *
 * Sprint 1 has publishers but no subscriber. That is deliberate — the seam is
 * cheaper to build now than to retrofit around a working gateway.
 */
export interface BusEvents {
  'vehicle:created': { vehicleId: string; operatorId: string; at: string };
  'vehicle:status': {
    vehicleId: string;
    from: VehicleStatus;
    to: VehicleStatus;
    at: string;
  };
}

export type BusEvent = keyof BusEvents;

class TypedBus {
  readonly #emitter = new EventEmitter();

  constructor() {
    // A publisher must never crash the process because nothing is listening.
    this.#emitter.setMaxListeners(50);
  }

  emit<K extends BusEvent>(event: K, payload: BusEvents[K]): void {
    this.#emitter.emit(event, payload);
  }

  on<K extends BusEvent>(event: K, handler: (payload: BusEvents[K]) => void): void {
    this.#emitter.on(event, handler);
  }

  off<K extends BusEvent>(event: K, handler: (payload: BusEvents[K]) => void): void {
    this.#emitter.off(event, handler);
  }

  once<K extends BusEvent>(event: K, handler: (payload: BusEvents[K]) => void): void {
    this.#emitter.once(event, handler);
  }

  listenerCount(event: BusEvent): number {
    return this.#emitter.listenerCount(event);
  }

  /** Test hygiene only. */
  removeAll(): void {
    this.#emitter.removeAllListeners();
  }
}

export const bus = new TypedBus();
