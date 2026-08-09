import { afterEach, describe, expect, it, vi } from 'vitest';
import { bus } from '../../src/realtime/bus.ts';

afterEach(() => {
  bus.removeAll();
});

describe('event bus', () => {
  it('delivers a payload to a subscriber', () => {
    const handler = vi.fn();
    bus.on('vehicle:status', handler);

    const payload = {
      vehicleId: '1',
      from: 'available',
      to: 'in_use',
      at: '2026-08-05T10:00:00.000Z',
    } as const;
    bus.emit('vehicle:status', payload);

    expect(handler).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it('delivers to every subscriber of the same event', () => {
    const a = vi.fn();
    const b = vi.fn();
    bus.on('vehicle:created', a);
    bus.on('vehicle:created', b);

    bus.emit('vehicle:created', { vehicleId: '1', operatorId: '2', at: 'now' });

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('does not cross events', () => {
    const handler = vi.fn();
    bus.on('vehicle:created', handler);
    bus.emit('vehicle:status', {
      vehicleId: '1',
      from: 'available',
      to: 'in_use',
      at: 'now',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('stops delivering after off()', () => {
    const handler = vi.fn();
    bus.on('vehicle:created', handler);
    bus.off('vehicle:created', handler);
    bus.emit('vehicle:created', { vehicleId: '1', operatorId: '2', at: 'now' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('emitting with no subscribers is a no-op, not a crash', () => {
    // Sprint 1 publishes with nothing listening until the Sprint 2 gateway
    // exists. That must be harmless.
    expect(bus.listenerCount('vehicle:status')).toBe(0);
    expect(() =>
      bus.emit('vehicle:status', { vehicleId: '1', from: 'available', to: 'in_use', at: 'now' }),
    ).not.toThrow();
  });
});
