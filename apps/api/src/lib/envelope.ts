import type { ApiError, ApiErrorDetail, ApiMeta, ApiSuccess, ErrorCode } from '@mm/shared-types';

export function ok<T>(data: T, meta?: ApiMeta): ApiSuccess<T> {
  return meta === undefined ? { data } : { data, meta };
}

export function fail(code: ErrorCode, message: string, details?: ApiErrorDetail[]): ApiError {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}
