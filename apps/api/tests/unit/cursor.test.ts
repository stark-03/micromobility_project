import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../../src/lib/cursor.ts';
import { AppError } from '../../src/lib/errors.ts';

describe('cursor', () => {
  it('round-trips', () => {
    const c = encodeCursor({ id: '42', ts: '2026-08-05T10:00:00.000Z' });
    expect(decodeCursor(c)).toEqual({ id: '42', ts: '2026-08-05T10:00:00.000Z' });
  });

  it('produces a URL-safe string', () => {
    const c = encodeCursor({ id: '999999999999999999', ts: '2026-08-05T10:00:00.000Z' });
    expect(c).toBe(encodeURIComponent(c));
  });

  it('rejects a tampered cursor', () => {
    expect(() => decodeCursor('not-base64-json')).toThrow(AppError);
  });

  it('rejects a cursor missing required fields', () => {
    const bad = Buffer.from(JSON.stringify({ id: '1' })).toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(AppError);
  });

  it('rejects a cursor whose fields are the wrong type', () => {
    const bad = Buffer.from(JSON.stringify({ id: 1, ts: null })).toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(AppError);
  });

  it('rejects a JSON array', () => {
    const bad = Buffer.from(JSON.stringify(['1', 'x'])).toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(AppError);
  });

  it('reports VALIDATION_FAILED rather than crashing the request', () => {
    try {
      decodeCursor('%%%');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as AppError).code).toBe('VALIDATION_FAILED');
      expect((e as AppError).status).toBe(400);
    }
  });

  it('preserves a BIGINT id exactly, with no float rounding', () => {
    // 2^63-1 style ids must survive; Number() would lose precision here.
    const id = '9223372036854775807';
    expect(decodeCursor(encodeCursor({ id, ts: '2026-08-05T10:00:00.000Z' })).id).toBe(id);
  });
});
