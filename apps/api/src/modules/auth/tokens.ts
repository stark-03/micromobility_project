import crypto from 'node:crypto';
import { Op } from 'sequelize';
import type { Transaction } from 'sequelize';
import { sequelize } from '../../db/index.ts';
import { RefreshToken, Role, User } from '../../db/models/index.ts';
import type { RevokedReason } from '../../db/models/refresh-token.ts';
import { AppError } from '../../lib/errors.ts';

/** SHA-256 hex. The raw token is never stored — it exists only in the cookie. */
export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function newRawToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Parses "7d" / "15m" / "3600s" into milliseconds. */
export function ttlToMs(ttl: string): number {
  const m = /^(\d+)\s*([smhd])$/.exec(ttl.trim());
  if (!m) throw new Error(`Unparseable TTL: "${ttl}"`);
  const n = Number(m[1]);
  const unit = m[2] as 's' | 'm' | 'h' | 'd';
  const factor = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return n * factor;
}

export interface TokenMeta {
  userAgent?: string | null;
  ip?: string | null;
}

function ipToBuffer(ip: string | null | undefined): Buffer | null {
  if (!ip) return null;
  return Buffer.from(ip, 'utf8').subarray(0, 16);
}

export interface IssuedRefreshToken {
  raw: string;
  record: RefreshToken;
}

export async function issueRefreshToken(
  userId: string,
  ttlMs: number,
  familyId?: string,
  meta: TokenMeta = {},
  transaction?: Transaction,
): Promise<IssuedRefreshToken> {
  const raw = newRawToken();
  const record = await RefreshToken.create(
    {
      user_id: userId,
      family_id: familyId ?? crypto.randomUUID(),
      token_hash: hashToken(raw),
      expires_at: new Date(Date.now() + ttlMs),
      user_agent: meta.userAgent ?? null,
      ip: ipToBuffer(meta.ip),
    },
    { transaction },
  );
  return { raw, record };
}

export async function revokeFamily(
  familyId: string,
  reason: RevokedReason,
  transaction?: Transaction,
): Promise<void> {
  await RefreshToken.update(
    { revoked_at: new Date(), revoked_reason: reason },
    { where: { family_id: familyId, revoked_at: null }, transaction },
  );
}

export interface RotationResult {
  raw: string;
  user: User;
  familyId: string;
}

/**
 * Rotates a refresh token.
 *
 * Runs inside a transaction with SELECT … FOR UPDATE on the presented row, so
 * two concurrent refreshes cannot both succeed and split the family.
 *
 * Reuse detection: presenting a token whose `used_at` is already set means the
 * cookie was captured and replayed — the legitimate client has already rotated
 * past it. The entire family is revoked, which signs out both the attacker and
 * the victim. That is the intended trade: a forced re-login beats a live
 * session in someone else's hands (design.md §7).
 */
/**
 * Rejections that must ALSO revoke something.
 *
 * Throwing out of `sequelize.transaction()` rolls the transaction back — which
 * would undo a revocation written inside it. Reuse detection would then return
 * the right error code while silently revoking nothing at all. So the failure
 * path returns this marker instead of throwing, and the cleanup runs in its own
 * transaction afterwards.
 */
interface RotationFailure {
  failed: true;
  error: AppError;
  revokeFamilyId?: string;
  revokeReason?: RevokedReason;
}

function isFailure(r: RotationResult | RotationFailure): r is RotationFailure {
  return (r as RotationFailure).failed === true;
}

export async function rotateRefreshToken(
  raw: string,
  ttlMs: number,
  meta: TokenMeta = {},
): Promise<RotationResult> {
  const outcome = await sequelize.transaction<RotationResult | RotationFailure>(async (t) => {
    const presented = await RefreshToken.findOne({
      where: { token_hash: hashToken(raw) },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (!presented) {
      return {
        failed: true,
        error: new AppError('REFRESH_TOKEN_INVALID', 'Refresh token is not recognised'),
      };
    }

    if (presented.used_at !== null) {
      return {
        failed: true,
        error: new AppError(
          'REFRESH_TOKEN_REUSED',
          'This refresh token has already been used. All sessions in this family have been revoked.',
        ),
        revokeFamilyId: presented.family_id,
        revokeReason: 'reuse_detected',
      };
    }

    if (presented.revoked_at !== null) {
      return {
        failed: true,
        error: new AppError('REFRESH_TOKEN_INVALID', 'Refresh token has been revoked'),
      };
    }

    if (presented.expires_at.getTime() <= Date.now()) {
      return {
        failed: true,
        error: new AppError('REFRESH_TOKEN_INVALID', 'Refresh token has expired'),
        revokeFamilyId: presented.family_id,
        revokeReason: 'expired',
      };
    }

    const user = await User.findByPk(presented.user_id, {
      include: [{ model: Role, as: 'roles' }],
      transaction: t,
    });
    if (!user) {
      return {
        failed: true,
        error: new AppError('REFRESH_TOKEN_INVALID', 'Refresh token has no owner'),
      };
    }
    if (user.status !== 'active') {
      return {
        failed: true,
        error: AppError.forbidden(`Account is ${user.status}`),
        revokeFamilyId: presented.family_id,
        revokeReason: 'logout',
      };
    }

    const next = await issueRefreshToken(presented.user_id, ttlMs, presented.family_id, meta, t);

    presented.used_at = new Date();
    presented.revoked_at = new Date();
    presented.revoked_reason = 'rotated';
    presented.replaced_by_id = next.record.id;
    await presented.save({ transaction: t });

    return { raw: next.raw, user, familyId: presented.family_id };
  });

  if (isFailure(outcome)) {
    // Committed separately, so it survives the failure it is reacting to.
    if (outcome.revokeFamilyId && outcome.revokeReason) {
      await revokeFamily(outcome.revokeFamilyId, outcome.revokeReason);
    }
    throw outcome.error;
  }

  return outcome;
}

/** Revokes the family a raw token belongs to. Used by logout. */
export async function revokeByRawToken(raw: string, reason: RevokedReason): Promise<void> {
  const record = await RefreshToken.findOne({ where: { token_hash: hashToken(raw) } });
  if (record) await revokeFamily(record.family_id, reason);
}

/** Housekeeping: drop expired rows. Wired to a cron job in a later sprint. */
export async function purgeExpiredTokens(): Promise<number> {
  return RefreshToken.destroy({ where: { expires_at: { [Op.lt]: new Date() } } });
}
