import crypto from 'node:crypto';
import { Op } from 'sequelize';
import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../lib/access-token.ts';
import { AppError } from '../lib/errors.ts';
import { ApiKey } from '../db/models/index.ts';

function bearer(req: Request): string | null {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/** Verifies the JWT access token and populates `req.user`. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = bearer(req);
  if (!token) {
    next(AppError.unauthenticated('Missing bearer token'));
    return;
  }

  try {
    const claims = verifyAccessToken(token);
    req.user = {
      id: claims.sub,
      email: claims.email,
      roles: claims.roles,
      operatorId: claims.operatorId,
    };
    next();
  } catch (e) {
    next(e);
  }
}

export function hashApiKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Device authentication for ingest endpoints. Keys look like
 * `mm_<8-char prefix>_<secret>`; the prefix is the indexed lookup handle and
 * only the SHA-256 of the whole key is stored.
 */
export function requireApiKey(requiredScope: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const raw = bearer(req);
    if (!raw?.startsWith('mm_')) {
      next(AppError.unauthenticated('Missing or malformed API key'));
      return;
    }

    void (async () => {
      try {
        const record = await ApiKey.findOne({
          where: {
            key_hash: hashApiKey(raw),
            revoked_at: null,
            [Op.or]: [{ expires_at: null }, { expires_at: { [Op.gt]: new Date() } }],
          },
        });

        if (!record) {
          next(AppError.unauthenticated('API key is invalid, revoked or expired'));
          return;
        }

        const scopes = Array.isArray(record.scopes) ? record.scopes : [];
        if (!scopes.includes(requiredScope)) {
          next(AppError.forbidden(`API key lacks the "${requiredScope}" scope`));
          return;
        }

        req.apiKey = {
          id: record.id,
          name: record.name,
          scopes,
          operatorId: record.operator_id ?? null,
        };

        // Best-effort usage stamp; never block the request on it.
        record.last_used_at = new Date();
        void record.save({ fields: ['last_used_at'] }).catch(() => undefined);

        next();
      } catch (e) {
        next(e);
      }
    })();
  };
}
