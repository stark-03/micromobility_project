import type { ApiErrorDetail, ErrorCode } from '@mm/shared-types';

export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  REFRESH_TOKEN_INVALID: 401,
  REFRESH_TOKEN_REUSED: 401,
  FORBIDDEN: 403,
  ROUTE_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  VEHICLE_NOT_FOUND: 404,
  MAINTENANCE_TICKET_NOT_FOUND: 404,
  SAVED_PLACE_NOT_FOUND: 404,
  EMAIL_ALREADY_REGISTERED: 409,
  VEHICLE_REF_ALREADY_EXISTS: 409,
  SAVED_PLACE_LABEL_EXISTS: 409,
  INVALID_STATE_TRANSITION: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ApiErrorDetail[];

  constructor(code: ErrorCode, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }

  static unauthenticated(message = 'Authentication required'): AppError {
    return new AppError('UNAUTHENTICATED', message);
  }

  static forbidden(message = 'You do not have access to this resource'): AppError {
    return new AppError('FORBIDDEN', message);
  }

  static notFound(code: ErrorCode, message: string): AppError {
    return new AppError(code, message);
  }

  static conflict(code: ErrorCode, message: string): AppError {
    return new AppError(code, message);
  }

  static validationFailed(details: ApiErrorDetail[]): AppError {
    return new AppError('VALIDATION_FAILED', 'Request validation failed', details);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
