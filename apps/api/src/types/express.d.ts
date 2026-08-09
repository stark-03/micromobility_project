import type { Role } from '@mm/shared-types';

declare global {
  namespace Express {
    interface Request {
      /** Populated by `validate()`. Controllers read this, never req.body. */
      valid?: { body?: unknown; query?: unknown; params?: unknown };
      /** Populated by `requireAuth`. */
      user?: {
        id: string;
        email: string;
        roles: Role[];
        operatorId: string | null;
      };
      /** Populated by `requireApiKey`. */
      apiKey?: {
        id: string;
        name: string;
        scopes: string[];
        operatorId: string | null;
      };
    }
  }
}

export {};
