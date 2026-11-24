import { ACCESS, dashboardFor, hasAccess } from '@mm/shared-types';
import type { AccessRule } from '@mm/shared-types';
import { useAuthStore } from './auth-store.ts';

/**
 * The web side of role-based access. The rules live in shared-types, and the
 * API enforces them; this only decides what to show.
 */

/** Which rule opens which screen. The router and the icon rail both read this. */
export const SCREEN_RULES: Readonly<Record<string, AccessRule>> = {
  '/live': 'live',
  '/plan': 'plan',
  '/ride': 'ride',
  '/trips': 'ride',
  '/sim': 'simRead',
  '/fleet': 'fleetRead',
  '/data': 'dataRead',
  '/admin': 'analytics',
};

export function canOpen(roles: readonly string[] | undefined, path: string): boolean {
  const rule = SCREEN_RULES[path];
  return rule ? hasAccess(roles, rule) : false;
}

/** Where a role lands after sign-in: its own dashboard (DASHBOARDS in shared-types). */
export function homeFor(roles: readonly string[] | undefined): string {
  return dashboardFor(roles).path;
}

/** Whether the signed-in user may use something, for hiding its button. */
export function useCan(rule: AccessRule): boolean {
  return useAuthStore((s) => hasAccess(s.user?.roles, rule));
}

export { ACCESS };
