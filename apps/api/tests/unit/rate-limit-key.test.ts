import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { issueAccessToken } from '../../src/lib/access-token.ts';
import { rateLimitKey } from '../../src/middleware/rate-limit.ts';

function req(token?: string): Request {
  return {
    ip: '127.0.0.1',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as unknown as Request;
}

describe('rateLimitKey', () => {
  it('gives two signed-in users on one machine separate allowances', () => {
    const a = issueAccessToken({ sub: '1', email: 'a@x.test', roles: ['admin'], operatorId: null });
    const b = issueAccessToken({ sub: '2', email: 'b@x.test', roles: ['commuter'], operatorId: null });
    expect(rateLimitKey(req(a))).toBe('user:1');
    expect(rateLimitKey(req(b))).toBe('user:2');
  });

  it('falls back to the address for anonymous requests and bad tokens', () => {
    expect(rateLimitKey(req())).toBe('127.0.0.1');
    expect(rateLimitKey(req('not-a-token'))).toBe('127.0.0.1');
  });
});
