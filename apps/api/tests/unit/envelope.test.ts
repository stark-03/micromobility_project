import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@mm/shared-types';
import { fail, ok } from '../../src/lib/envelope.ts';
import { AppError, STATUS_BY_CODE } from '../../src/lib/errors.ts';

describe('envelope', () => {
  it('omits meta when not supplied', () => {
    expect(ok({ id: '1' })).toEqual({ data: { id: '1' } });
  });

  it('includes meta when supplied', () => {
    expect(ok([], { page: 1, limit: 20, total: 0 })).toEqual({
      data: [],
      meta: { page: 1, limit: 20, total: 0 },
    });
  });

  it('omits details when not supplied', () => {
    expect(fail('USER_NOT_FOUND', 'nope')).toEqual({
      error: { code: 'USER_NOT_FOUND', message: 'nope' },
    });
  });

  it('includes details when supplied', () => {
    expect(fail('VALIDATION_FAILED', 'bad', [{ path: 'email', message: 'required' }])).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'bad',
        details: [{ path: 'email', message: 'required' }],
      },
    });
  });
});

describe('AppError', () => {
  it('derives HTTP status from the error code', () => {
    expect(AppError.forbidden().status).toBe(403);
    expect(AppError.unauthenticated().status).toBe(401);
    expect(AppError.conflict('INVALID_STATE_TRANSITION', 'x').status).toBe(409);
    expect(AppError.notFound('VEHICLE_NOT_FOUND', 'x').status).toBe(404);
  });

  it('maps every declared code to a 4xx or 5xx status', () => {
    for (const code of ERROR_CODES) {
      const status = STATUS_BY_CODE[code];
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(600);
    }
  });

  it('carries validation details', () => {
    const e = AppError.validationFailed([{ path: 'email', message: 'required' }]);
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(e.details).toHaveLength(1);
  });
});
