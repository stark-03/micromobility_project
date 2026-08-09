import { describe, expect, it } from 'vitest';
import { RefreshToken } from '../../src/db/models/index.ts';
import { AppError } from '../../src/lib/errors.ts';
import {
  hashToken,
  issueRefreshToken,
  revokeFamily,
  rotateRefreshToken,
} from '../../src/modules/auth/tokens.ts';
import { useCleanDatabase } from '../helpers/clean-db.ts';
import { makeUser } from '../helpers/fixtures.ts';

useCleanDatabase();

const WEEK = 7 * 24 * 60 * 60 * 1000;

describe('refresh token rotation', () => {
  it('stores only the hash, never the raw token', async () => {
    const { user } = await makeUser({ role: 'commuter' });
    const { raw, record } = await issueRefreshToken(user.id, WEEK);

    expect(record.token_hash).toBe(hashToken(raw));
    expect(record.token_hash).not.toBe(raw);
    expect(record.token_hash).toHaveLength(64);

    // And nothing anywhere in the row contains the raw value.
    expect(JSON.stringify(record.toJSON())).not.toContain(raw);
  });

  it('rotating marks the old token used and issues a successor in the same family', async () => {
    const { user } = await makeUser({ role: 'commuter' });
    const first = await issueRefreshToken(user.id, WEEK);
    const second = await rotateRefreshToken(first.raw, WEEK);

    const old = await RefreshToken.findByPk(first.record.id);
    expect(old!.used_at).not.toBeNull();
    expect(old!.replaced_by_id).not.toBeNull();
    expect(old!.revoked_reason).toBe('rotated');

    const next = await RefreshToken.findOne({ where: { token_hash: hashToken(second.raw) } });
    expect(next).not.toBeNull();
    expect(next!.family_id).toBe(first.record.family_id);
    expect(second.raw).not.toBe(first.raw);
  });

  it('reusing a spent token revokes the entire family', async () => {
    const { user } = await makeUser({ role: 'commuter' });
    const first = await issueRefreshToken(user.id, WEEK);
    await rotateRefreshToken(first.raw, WEEK);

    await expect(rotateRefreshToken(first.raw, WEEK)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_REUSED',
    });

    const family = await RefreshToken.findAll({ where: { family_id: first.record.family_id } });
    expect(family.length).toBeGreaterThanOrEqual(2);
    expect(family.every((t) => t.revoked_at !== null)).toBe(true);
    expect(family.some((t) => t.revoked_reason === 'reuse_detected')).toBe(true);
  });

  it('a revoked family cannot be rotated again — the thief is locked out too', async () => {
    const { user } = await makeUser({ role: 'commuter' });
    const first = await issueRefreshToken(user.id, WEEK);
    const second = await rotateRefreshToken(first.raw, WEEK);

    // Attacker replays the old cookie, which burns the family...
    await expect(rotateRefreshToken(first.raw, WEEK)).rejects.toThrow(AppError);
    // ...so the victim's current token stops working as well. Forced re-login
    // beats leaving a live session in someone else's hands.
    await expect(rotateRefreshToken(second.raw, WEEK)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_INVALID',
    });
  });

  it('rejects an unknown token', async () => {
    await expect(rotateRefreshToken('nonsense', WEEK)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_INVALID',
    });
  });

  it('rejects an expired token and marks why', async () => {
    const { user } = await makeUser({ role: 'commuter' });
    const { raw, record } = await issueRefreshToken(user.id, WEEK);

    record.expires_at = new Date(Date.now() - 1000);
    await record.save();

    await expect(rotateRefreshToken(raw, WEEK)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_INVALID',
    });
    const after = await RefreshToken.findByPk(record.id);
    expect(after!.revoked_reason).toBe('expired');
  });

  it('rejects a token whose owner is suspended, and kills the family', async () => {
    const { user } = await makeUser({ role: 'commuter' });
    const { raw, record } = await issueRefreshToken(user.id, WEEK);

    user.status = 'suspended';
    await user.save();

    await expect(rotateRefreshToken(raw, WEEK)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const family = await RefreshToken.findAll({ where: { family_id: record.family_id } });
    expect(family.every((t) => t.revoked_at !== null)).toBe(true);
  });

  it('revokeFamily only touches the named family', async () => {
    const { user } = await makeUser({ role: 'commuter' });
    const a = await issueRefreshToken(user.id, WEEK);
    const b = await issueRefreshToken(user.id, WEEK);

    await revokeFamily(a.record.family_id, 'logout');

    expect((await RefreshToken.findByPk(a.record.id))!.revoked_at).not.toBeNull();
    expect((await RefreshToken.findByPk(b.record.id))!.revoked_at).toBeNull();
  });

  it('gives separate sign-ins separate families', async () => {
    const { user } = await makeUser({ role: 'commuter' });
    const a = await issueRefreshToken(user.id, WEEK);
    const b = await issueRefreshToken(user.id, WEEK);
    // Signing out on a phone must not sign you out on a laptop.
    expect(a.record.family_id).not.toBe(b.record.family_id);
  });
});
