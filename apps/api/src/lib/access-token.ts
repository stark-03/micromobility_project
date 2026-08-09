import jwt from 'jsonwebtoken';
import type { Role } from '@mm/shared-types';
import { env } from '../config/env.ts';
import { AppError } from './errors.ts';

/**
 * Access-token primitives.
 *
 * These live in lib/ rather than modules/auth/ because both the auth module
 * (which issues) and the auth middleware (which verifies) need them, and
 * importing the module from the middleware would make a cycle.
 */
export interface AccessTokenClaims {
  sub: string;
  email: string;
  roles: Role[];
  operatorId: string | null;
}

export function issueAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(
    {
      email: claims.email,
      roles: claims.roles,
      operatorId: claims.operatorId === null ? null : String(claims.operatorId),
    },
    env.jwt.accessSecret,
    {
      // Coerced deliberately. A model returned by Model.create() carries the
      // driver's numeric insertId, while one returned by a SELECT carries a
      // string (dialectOptions.bigNumberStrings). jsonwebtoken rejects a
      // non-string `subject` outright, so registration would 500 while login
      // succeeded. Normalising here fixes the whole class at one choke point.
      subject: String(claims.sub),
      expiresIn: env.jwt.accessTtl,
    } as jwt.SignOptions,
  );
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.jwt.accessSecret) as jwt.JwtPayload;
  } catch (e) {
    // TOKEN_EXPIRED is a distinct code because the client acts on it: it
    // triggers exactly one refresh-and-replay. Any other failure means sign in
    // again.
    if (e instanceof jwt.TokenExpiredError) {
      throw new AppError('TOKEN_EXPIRED', 'Access token has expired');
    }
    throw new AppError('UNAUTHENTICATED', 'Access token is invalid');
  }

  const { sub, email, roles, operatorId } = payload;
  if (typeof sub !== 'string' || typeof email !== 'string' || !Array.isArray(roles)) {
    throw new AppError('UNAUTHENTICATED', 'Access token is malformed');
  }

  return {
    sub,
    email,
    roles: roles as Role[],
    operatorId: typeof operatorId === 'string' ? operatorId : null,
  };
}
