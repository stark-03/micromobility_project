import { describe, expect, it } from 'vitest';
import { VEHICLE_STATUSES } from '@mm/shared-types';
import type { VehicleStatus } from '@mm/shared-types';
import {
  allowedFrom,
  assertTransition,
  canTransition,
  TRANSITIONS,
} from '../../src/modules/vehicles/state-machine.ts';

/**
 * The contract from the spec §5, restated independently of the implementation.
 * If these two ever disagree, one of them is a bug — that is the point.
 */
const LEGAL: Record<VehicleStatus, VehicleStatus[]> = {
  available: ['reserved', 'in_use', 'charging', 'maintenance', 'retired'],
  reserved: ['in_use', 'available', 'maintenance'],
  in_use: ['returning', 'maintenance'],
  returning: ['available', 'charging', 'maintenance'],
  charging: ['available', 'maintenance', 'retired'],
  maintenance: ['available', 'charging', 'retired'],
  retired: [],
};

describe('vehicle state machine', () => {
  it('declares exactly 19 legal edges', () => {
    const count = Object.values(TRANSITIONS).reduce((n, xs) => n + xs.length, 0);
    expect(count).toBe(19);
  });

  it('accepts or rejects every one of the 49 ordered pairs correctly', () => {
    let accepted = 0;
    let rejected = 0;

    for (const from of VEHICLE_STATUSES) {
      for (const to of VEHICLE_STATUSES) {
        const expected = LEGAL[from].includes(to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
        if (expected) accepted += 1;
        else rejected += 1;
      }
    }

    expect(accepted).toBe(19);
    expect(rejected).toBe(30);
  });

  it('rejects every self-transition', () => {
    // Rejected rather than treated as a no-op, so a duplicated request cannot
    // write a spurious vehicle_status_history row.
    for (const s of VEHICLE_STATUSES) {
      expect(canTransition(s, s), `${s} -> ${s}`).toBe(false);
    }
  });

  it('treats retired as terminal', () => {
    for (const to of VEHICLE_STATUSES) expect(canTransition('retired', to)).toBe(false);
    expect(allowedFrom('retired')).toEqual([]);
  });

  it('allows scan-and-go: available straight to in_use without reserving', () => {
    expect(canTransition('available', 'in_use')).toBe(true);
  });

  it('allows a breakdown mid-ride from any live state', () => {
    for (const live of ['available', 'reserved', 'in_use', 'returning'] as const) {
      expect(canTransition(live, 'maintenance'), `${live} -> maintenance`).toBe(true);
    }
  });

  it('allows a reservation to lapse back to available', () => {
    expect(canTransition('reserved', 'available')).toBe(true);
  });

  it('does not allow a vehicle to be retired mid-ride', () => {
    // It has a rider on it. Retire it after it comes back.
    expect(canTransition('in_use', 'retired')).toBe(false);
    expect(canTransition('reserved', 'retired')).toBe(false);
    expect(canTransition('returning', 'retired')).toBe(false);
  });

  it('assertTransition passes silently for a legal move', () => {
    expect(() => assertTransition('available', 'in_use')).not.toThrow();
  });

  it('assertTransition throws INVALID_STATE_TRANSITION naming both states', () => {
    expect(() => assertTransition('retired', 'available')).toThrowError(/retired.*available/);
    try {
      assertTransition('in_use', 'retired');
      expect.unreachable('should have thrown');
    } catch (e) {
      const err = e as { code: string; status: number; message: string };
      expect(err.code).toBe('INVALID_STATE_TRANSITION');
      expect(err.status).toBe(409);
      // The message must say what IS allowed, or the caller has to guess.
      expect(err.message).toMatch(/returning/);
    }
  });

  it('tells the caller a terminal state is terminal', () => {
    try {
      assertTransition('retired', 'maintenance');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).message).toMatch(/terminal/i);
    }
  });

  it('is a pure function — repeated calls never mutate the table', () => {
    const snapshot = JSON.stringify(TRANSITIONS);
    for (const from of VEHICLE_STATUSES) {
      for (const to of VEHICLE_STATUSES) canTransition(from, to);
    }
    expect(JSON.stringify(TRANSITIONS)).toBe(snapshot);
  });

  it('exposes a frozen table so a caller cannot widen the rules at runtime', () => {
    expect(Object.isFrozen(TRANSITIONS)).toBe(true);
    expect(Object.isFrozen(TRANSITIONS.available)).toBe(true);
  });
});
