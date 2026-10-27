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
  LAST_ADMIN_PROTECTED: 409,
  INVALID_STATE_TRANSITION: 409,
  NO_ROUTE_FOUND: 422,
  SCENARIO_NOT_FOUND: 404,
  RUN_NOT_FOUND: 404,
  // The run exists but has no results yet — a state problem, not a
  // missing resource, so 409 rather than 404.
  RUN_NOT_COMPLETED: 409,
  PLAN_NOT_FOUND: 404,
  TASK_NOT_FOUND: 404,
  STATION_NOT_FOUND: 404,
  RENTAL_NOT_FOUND: 404,
  // The vehicle exists but cannot be ridden right now: in use, charging,
  // in the workshop, or too flat to finish a ride.
  VEHICLE_NOT_RENTABLE: 409,
  RENTAL_ALREADY_ACTIVE: 409,
  // A return is verified by position. Ending a ride away from a station is a
  // request the rider can fix by moving, so 422 rather than 409.
  RETURN_NOT_AT_STATION: 422,
  STATION_FULL: 409,
  PAYMENT_FAILED: 402,
  SERVICE_UNAVAILABLE: 503,
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
