import type { VehicleStatus } from '@mm/shared-types';
import { AppError } from '../../lib/errors.ts';

/**
 * Vehicle lifecycle. A pure function: no I/O, no clock, no database.
 *
 * MODULES.md M03 writes the states as a chain —
 *   available → reserved → in_use → returning → charging → maintenance → retired
 * — but that is a reading order, not the transition graph. The contract is
 * spec §5:
 *
 *   - `reserved` is optional. Scan-and-go unlocks straight from `available`
 *     to `in_use`, which is how most riders actually start a trip.
 *   - `maintenance` and `charging` are reachable from any live state, because
 *     breakdowns happen mid-ride and a vehicle does not wait politely.
 *   - `retired` is terminal. A one-way door keeps `retired` a trustworthy
 *     filter; refurbishment registers a new vehicle rather than resurrecting
 *     a written-off one.
 *   - A vehicle cannot be retired mid-ride — it has a rider on it.
 *   - Self-transitions are REJECTED rather than treated as no-ops, so a
 *     duplicated request cannot write a spurious status-history row.
 *
 * 19 legal edges out of 42 ordered pairs of distinct states.
 */
export const TRANSITIONS: Readonly<Record<VehicleStatus, readonly VehicleStatus[]>> =
  Object.freeze({
    available: Object.freeze([
      'reserved',
      'in_use',
      'charging',
      'maintenance',
      'retired',
    ] as const),
    reserved: Object.freeze(['in_use', 'available', 'maintenance'] as const),
    in_use: Object.freeze(['returning', 'maintenance'] as const),
    returning: Object.freeze(['available', 'charging', 'maintenance'] as const),
    charging: Object.freeze(['available', 'maintenance', 'retired'] as const),
    maintenance: Object.freeze(['available', 'charging', 'retired'] as const),
    retired: Object.freeze([] as const),
  });

export function allowedFrom(status: VehicleStatus): readonly VehicleStatus[] {
  return TRANSITIONS[status];
}

export function canTransition(from: VehicleStatus, to: VehicleStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: VehicleStatus, to: VehicleStatus): void {
  if (canTransition(from, to)) return;

  const allowed = TRANSITIONS[from];
  const suffix =
    allowed.length > 0
      ? `Allowed from "${from}": ${allowed.join(', ')}.`
      : `"${from}" is a terminal state — no transitions are possible.`;

  throw new AppError(
    'INVALID_STATE_TRANSITION',
    `Cannot move a vehicle from "${from}" to "${to}". ${suffix}`,
  );
}
