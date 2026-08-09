import type { CookieOptions, Request, Response } from 'express';
import type { AuthResponseDto } from '@mm/shared-types';
import { env } from '../../config/env.ts';
import { issueAccessToken } from '../../lib/access-token.ts';
import { ok } from '../../lib/envelope.ts';
import { AppError } from '../../lib/errors.ts';
import { body } from '../../middleware/validate.ts';
import { AUDIT, record } from '../audit/service.ts';
import { toUserDto } from './dto.ts';
import type { LoginInput, RegisterInput } from './dto.ts';
import {
  authenticate,
  getUserRoles,
  markLogin,
  registerUser,
} from './service.ts';
import {
  issueRefreshToken,
  revokeByRawToken,
  rotateRefreshToken,
  ttlToMs,
} from './tokens.ts';

export const REFRESH_COOKIE = 'mm_refresh';

/**
 * Path-scoped so the cookie is only ever sent to the auth endpoints that need
 * it — it never rides along on ordinary API calls. SameSite=Strict per
 * design.md §7; Secure only in production, since local dev is plain http.
 */
function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.isProduction,
    path: '/api/v1/auth',
    maxAge: ttlToMs(env.jwt.refreshTtl),
  };
}

function meta(req: Request) {
  return { userAgent: req.get('user-agent') ?? null, ip: req.ip ?? null };
}

export async function register(req: Request, res: Response): Promise<void> {
  const input = body<RegisterInput>(req);
  const user = await registerUser(input);
  const roles = await getUserRoles(user.id);

  const { raw } = await issueRefreshToken(
    user.id,
    ttlToMs(env.jwt.refreshTtl),
    undefined,
    meta(req),
  );
  res.cookie(REFRESH_COOKIE, raw, cookieOptions());

  await record({
    actorType: 'user',
    actorId: user.id,
    action: AUDIT.REGISTER,
    subjectType: 'user',
    subjectId: user.id,
    ip: req.ip,
  });

  const payload: AuthResponseDto = {
    accessToken: issueAccessToken({
      sub: user.id,
      email: user.email,
      roles,
      operatorId: user.operator_id ?? null,
    }),
    user: toUserDto(user, roles),
  };
  res.status(201).json(ok(payload));
}

export async function login(req: Request, res: Response): Promise<void> {
  const input = body<LoginInput>(req);

  let authed;
  try {
    authed = await authenticate(input.email, input.password);
  } catch (e) {
    await record({
      actorType: 'system',
      action: AUDIT.LOGIN_FAILURE,
      subjectType: 'email',
      metadata: { email: input.email },
      ip: req.ip,
    });
    throw e;
  }

  const { user, roles } = authed;
  await markLogin(user);

  const { raw } = await issueRefreshToken(
    user.id,
    ttlToMs(env.jwt.refreshTtl),
    undefined,
    meta(req),
  );
  res.cookie(REFRESH_COOKIE, raw, cookieOptions());

  await record({
    actorType: 'user',
    actorId: user.id,
    action: AUDIT.LOGIN_SUCCESS,
    subjectType: 'user',
    subjectId: user.id,
    ip: req.ip,
  });

  const payload: AuthResponseDto = {
    accessToken: issueAccessToken({
      sub: user.id,
      email: user.email,
      roles,
      operatorId: user.operator_id ?? null,
    }),
    user: toUserDto(user, roles),
  };
  res.json(ok(payload));
}

export async function refresh(req: Request, res: Response): Promise<void> {
  // Read the cookie ONLY. Accepting the token from a body field would let a
  // cross-site page supply one it had stolen by other means.
  const raw = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
  if (!raw) {
    throw new AppError('REFRESH_TOKEN_INVALID', 'No refresh token supplied');
  }

  let rotated;
  try {
    rotated = await rotateRefreshToken(raw, ttlToMs(env.jwt.refreshTtl), meta(req));
  } catch (e) {
    if (e instanceof AppError && e.code === 'REFRESH_TOKEN_REUSED') {
      res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
      await record({
        actorType: 'system',
        action: AUDIT.REFRESH_REUSE_DETECTED,
        subjectType: 'refresh_token',
        ip: req.ip,
      });
    }
    throw e;
  }

  const roles = await getUserRoles(rotated.user.id);
  res.cookie(REFRESH_COOKIE, rotated.raw, cookieOptions());

  const payload: AuthResponseDto = {
    accessToken: issueAccessToken({
      sub: rotated.user.id,
      email: rotated.user.email,
      roles,
      operatorId: rotated.user.operator_id ?? null,
    }),
    user: toUserDto(rotated.user, roles),
  };
  res.json(ok(payload));
}

export async function logout(req: Request, res: Response): Promise<void> {
  const raw = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
  if (raw) await revokeByRawToken(raw, 'logout');

  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });

  await record({
    actorType: 'user',
    actorId: req.user?.id ?? null,
    action: AUDIT.LOGOUT,
    ip: req.ip,
  });

  res.json(ok({ loggedOut: true }));
}
