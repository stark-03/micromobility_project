import { describe, expect, it } from 'vitest';
import type { Role } from '@mm/shared-types';
import { canJoin } from '../../src/realtime/gateway.ts';

function user(roles: Role[], id = '1', operatorId: string | null = null) {
  return { id, roles, operatorId };
}

/**
 * CLAUDE.md: join is authorized against the user's roles — never trust a
 * client-supplied room name. These cases are the reason that rule exists.
 */
describe('socket room authorization', () => {
  it('lets any signed-in user watch a zone — traffic is city-wide information', () => {
    expect(canJoin(user(['commuter']), 'zone:3')).toBe(true);
    expect(canJoin(user(['planner']), 'zone:8')).toBe(true);
  });

  it('lets a user join only their OWN user room', () => {
    expect(canJoin(user(['commuter'], '7'), 'user:7')).toBe(true);
    expect(canJoin(user(['commuter'], '7'), 'user:8')).toBe(false);
  });

  it('does not let a commuter watch an operator fleet', () => {
    // Otherwise any signed-in rider could stream a company's vehicle movements.
    expect(canJoin(user(['commuter'], '7'), 'operator:2')).toBe(false);
  });

  it('scopes an operator to their own operator room', () => {
    const op = user(['operator'], '7', '2');
    expect(canJoin(op, 'operator:2')).toBe(true);
    expect(canJoin(op, 'operator:3')).toBe(false);
  });

  it('lets staff roles watch any operator', () => {
    for (const role of ['admin', 'planner', 'analyst'] as const) {
      expect(canJoin(user([role]), 'operator:99'), role).toBe(true);
    }
  });

  it('restricts simulation run rooms to planners and above', () => {
    expect(canJoin(user(['planner']), 'run:12')).toBe(true);
    expect(canJoin(user(['admin']), 'run:12')).toBe(true);
    expect(canJoin(user(['analyst']), 'run:12')).toBe(true);
    expect(canJoin(user(['commuter']), 'run:12')).toBe(false);
    expect(canJoin(user(['operator'], '7', '2'), 'run:12')).toBe(false);
  });

  it('rejects an unknown room kind rather than defaulting to allow', () => {
    expect(canJoin(user(['admin']), 'secrets:1')).toBe(false);
    expect(canJoin(user(['admin']), 'admin')).toBe(false);
    expect(canJoin(user(['admin']), '')).toBe(false);
  });

  it('rejects a malformed room name', () => {
    expect(canJoin(user(['admin']), 'zone:')).toBe(false);
    expect(canJoin(user(['commuter'], '7'), 'user:')).toBe(false);
  });

  it('does not let a role list be widened by a crafted room string', () => {
    // A room like "operator:2:admin" must not squeak through on a prefix match.
    expect(canJoin(user(['operator'], '7', '2'), 'operator:3:2')).toBe(false);
  });
});
