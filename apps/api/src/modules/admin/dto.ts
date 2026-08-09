import { z } from 'zod';
import { ROLES, USER_STATUSES } from '@mm/shared-types';
import type { ApiKeyDto } from '@mm/shared-types';
import type { ApiKey } from '../../db/models/index.ts';

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  q: z.string().min(1).max(120).trim().optional(),
});

export const setRolesSchema = z.object({
  roles: z.array(z.enum(ROLES)).min(1, 'A user must hold at least one role'),
});

export const createApiKeySchema = z.object({
  name: z.string().min(2).max(120).trim(),
  scopes: z.array(z.string().min(1).max(64)).min(1, 'An API key needs at least one scope'),
  operatorId: z.string().regex(/^\d+$/).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const idParamSchema = z.object({ id: z.string().regex(/^\d+$/, 'Must be a numeric id') });

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type SetRolesInput = z.infer<typeof setRolesSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export function toApiKeyDto(k: ApiKey): ApiKeyDto {
  return {
    id: String(k.id),
    name: k.name,
    keyPrefix: k.key_prefix,
    scopes: Array.isArray(k.scopes) ? k.scopes : [],
    operatorId: k.operator_id === null ? null : String(k.operator_id),
    lastUsedAt: k.last_used_at?.toISOString() ?? null,
    expiresAt: k.expires_at?.toISOString() ?? null,
    revokedAt: k.revoked_at?.toISOString() ?? null,
    createdAt: k.created_at.toISOString(),
  };
}
