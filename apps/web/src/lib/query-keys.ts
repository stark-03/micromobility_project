import type { VehicleStatus, VehicleType } from '@mm/shared-types';

export interface VehicleListParams {
  page: number;
  limit: number;
  status?: VehicleStatus | '';
  type?: VehicleType | '';
  zoneId?: string;
}

/**
 * TanStack Query keys, in the ['module', 'resource', params] shape CLAUDE.md
 * specifies. Declared here so a mutation can invalidate a precise key rather
 * than blowing away the whole cache.
 */
export const queryKeys = {
  vehicles: {
    all: ['vehicles'] as const,
    list: (params: VehicleListParams) => ['vehicles', 'list', params] as const,
    detail: (id: string) => ['vehicles', 'detail', id] as const,
  },
  users: {
    me: ['users', 'me'] as const,
  },
} as const;
