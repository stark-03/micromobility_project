import type { Transaction } from 'sequelize';
import { AuditLog } from '../../db/models/index.ts';
import type { ActorType } from '../../db/models/audit-log.ts';
import { logger } from '../../lib/logger.ts';

export interface AuditEntry {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  subjectType?: string | null;
  subjectId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}

/**
 * Audit trail for sensitive actions (design.md §7, CLAUDE.md security rules).
 *
 * Never throws: an audit write failing must not fail the operation the user
 * asked for. A dropped audit row is logged loudly instead.
 */
export async function record(entry: AuditEntry, transaction?: Transaction): Promise<void> {
  try {
    await AuditLog.create(
      {
        actor_type: entry.actorType,
        actor_id: entry.actorId ?? null,
        action: entry.action,
        subject_type: entry.subjectType ?? null,
        subject_id: entry.subjectId ?? null,
        metadata: entry.metadata ?? null,
        ip: entry.ip ? Buffer.from(entry.ip, 'utf8').subarray(0, 16) : null,
      },
      { transaction },
    );
  } catch (e) {
    logger.error('Failed to write audit log', {
      action: entry.action,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export const AUDIT = {
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILURE: 'auth.login.failure',
  LOGOUT: 'auth.logout',
  REGISTER: 'auth.register',
  REFRESH_REUSE_DETECTED: 'auth.refresh.reuse_detected',
  ROLES_CHANGED: 'admin.user.roles_changed',
  API_KEY_CREATED: 'admin.api_key.created',
  API_KEY_REVOKED: 'admin.api_key.revoked',
  VEHICLE_CREATED: 'vehicle.created',
  VEHICLE_UPDATED: 'vehicle.updated',
  VEHICLE_STATUS_CHANGED: 'vehicle.status_changed',
  VEHICLE_DELETED: 'vehicle.deleted',
} as const;
