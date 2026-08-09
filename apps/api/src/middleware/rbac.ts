import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@mm/shared-types';
import { AppError } from '../lib/errors.ts';

/**
 * Route-level role gate.
 *
 * `requireRole` establishes WHICH roles may call an endpoint. It deliberately
 * does not decide WHICH ROWS they may touch — operator scoping lives in the
 * service layer, against `req.user.operatorId`. Keeping the two separate is why
 * an operator can call GET /vehicles at all while still only seeing their own
 * fleet.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(AppError.unauthenticated());
      return;
    }
    if (!req.user.roles.some((r) => roles.includes(r))) {
      next(AppError.forbidden(`Requires one of: ${roles.join(', ')}`));
      return;
    }
    next();
  };
}

export function hasRole(req: Request, role: Role): boolean {
  return req.user?.roles.includes(role) ?? false;
}
