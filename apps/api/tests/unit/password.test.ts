import { describe, expect, it } from 'vitest';
import { BCRYPT_COST, hashPassword, verifyPassword } from '../../src/modules/auth/service.ts';
import { ttlToMs } from '../../src/modules/auth/tokens.ts';

describe('password hashing', () => {
  it('produces a bcrypt hash at the configured cost, not the plaintext', async () => {
    const hash = await hashPassword('Test1234!pass');
    expect(hash).not.toBe('Test1234!pass');
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(BCRYPT_COST).toBe(12);
  });

  it('salts — the same password hashes differently each time', async () => {
    const [a, b] = await Promise.all([hashPassword('Test1234!pass'), hashPassword('Test1234!pass')]);
    expect(a).not.toBe(b);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('Test1234!pass');
    expect(await verifyPassword('Test1234!pass', hash)).toBe(true);
    expect(await verifyPassword('Test1234!pasS', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('returns false rather than throwing on a malformed hash', async () => {
    // authenticate() compares against a dummy hash when no user matched, to
    // keep response time constant. That path must not throw.
    expect(await verifyPassword('anything', 'not-a-bcrypt-hash')).toBe(false);
  });
});

describe('ttlToMs', () => {
  it('parses the TTL formats used in .env', () => {
    expect(ttlToMs('15m')).toBe(900_000);
    expect(ttlToMs('7d')).toBe(604_800_000);
    expect(ttlToMs('30s')).toBe(30_000);
    expect(ttlToMs('2h')).toBe(7_200_000);
  });

  it('rejects an unparseable TTL rather than silently defaulting', () => {
    expect(() => ttlToMs('forever')).toThrow(/Unparseable TTL/);
    expect(() => ttlToMs('7')).toThrow(/Unparseable TTL/);
  });
});
