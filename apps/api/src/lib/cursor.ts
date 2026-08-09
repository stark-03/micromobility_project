import { AppError } from './errors.ts';

/**
 * Opaque pagination cursor for feed endpoints (trips, telemetry).
 *
 * Keyset pagination on (timestamp, id): the id breaks ties so two rows sharing
 * a millisecond cannot be skipped or repeated across pages, which OFFSET
 * pagination gets wrong the moment rows are inserted mid-scroll.
 *
 * The value is base64url JSON — opaque to clients, but deliberately NOT signed.
 * It carries no authorisation; every query it feeds is already scoped to the
 * caller, so a forged cursor can only reposition a caller within their own rows.
 */
export interface Cursor {
  /** BIGINT as a string — never a number, which would lose precision. */
  id: string;
  /** ISO-8601 UTC timestamp. */
  ts: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify({ id: c.id, ts: c.ts }), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  const invalid = (): never => {
    throw AppError.validationFailed([{ path: 'cursor', message: 'Malformed pagination cursor' }]);
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return invalid();
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return invalid();

  const { id, ts } = parsed as Record<string, unknown>;
  if (typeof id !== 'string' || typeof ts !== 'string') return invalid();
  if (Number.isNaN(Date.parse(ts))) return invalid();

  return { id, ts };
}
