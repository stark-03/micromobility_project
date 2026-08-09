import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../lib/errors.ts';

export interface ValidSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Parses request parts with zod at the route boundary and stashes the typed
 * result on `req.valid`.
 *
 * Controllers read `req.valid.body`, never `req.body` — the CLAUDE.md contract
 * is that a controller receives parsed, typed input and never touches `req`
 * beyond `req.user`.
 */
export function validate(schemas: ValidSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const valid: { body?: unknown; query?: unknown; params?: unknown } = {};

    for (const part of ['body', 'query', 'params'] as const) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);
      if (!result.success) {
        next(
          AppError.validationFailed(
            result.error.issues.map((i) => ({
              path: i.path.join('.') || part,
              message: i.message,
            })),
          ),
        );
        return;
      }
      valid[part] = result.data;
    }

    req.valid = valid;
    next();
  };
}

/** Typed accessors — a controller should never cast `req.valid` itself. */
export function body<T>(req: Request): T {
  return req.valid?.body as T;
}
export function query<T>(req: Request): T {
  return req.valid?.query as T;
}
export function params<T>(req: Request): T {
  return req.valid?.params as T;
}
