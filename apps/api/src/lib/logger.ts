import { env } from '../config/env.ts';

type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = env.isTest ? ORDER.error : ORDER.debug;

function emit(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (ORDER[level] < threshold) return;
  const line = { ts: new Date().toISOString(), level, message, ...meta };
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(JSON.stringify(line));
}

/**
 * Structured logger.
 *
 * CLAUDE.md guardrail: never log coordinates tied to a user_id at info level.
 * Trip geometry is sensitive — aggregate before it reaches analytics, and keep
 * raw positions out of application logs entirely.
 */
export const logger = {
  debug: (m: string, meta?: Record<string, unknown>) => emit('debug', m, meta),
  info: (m: string, meta?: Record<string, unknown>) => emit('info', m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => emit('warn', m, meta),
  error: (m: string, meta?: Record<string, unknown>) => emit('error', m, meta),
};
