import type { NextFunction, Request, Response } from 'express';
import { fail } from '../lib/envelope.ts';
import { AppError } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';

/** 404 for anything the router did not match. Mounted before the error handler. */
export function notFoundHandler(req: Request, res: Response): void {
  res
    .status(404)
    .json(fail('ROUTE_NOT_FOUND', `No route matches ${req.method} ${req.originalUrl}`));
}

/**
 * Final middleware. Turns anything thrown into the error envelope.
 *
 * An unrecognised error becomes a bare 500 INTERNAL_ERROR: the stack is logged
 * server-side and never returned, because a stack trace tells an attacker the
 * file layout, dependency versions and often the query shape.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    // Client errors are noise at error level; 5xx AppErrors are not.
    if (err.status >= 500) {
      logger.error(err.message, { code: err.code, path: req.originalUrl });
    } else {
      logger.debug(err.message, { code: err.code, path: req.originalUrl });
    }
    res.status(err.status).json(fail(err.code, err.message, err.details));
    return;
  }

  logger.error('Unhandled error', {
    path: req.originalUrl,
    method: req.method,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });

  res.status(500).json(fail('INTERNAL_ERROR', 'Something went wrong on our end'));
}

/**
 * Express 4 does not catch a rejected promise from an async handler — it hangs
 * the request instead. Every async route handler is wrapped in this.
 */
export function asyncHandler<T>(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<T>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
