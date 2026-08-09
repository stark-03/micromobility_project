import rateLimit from 'express-rate-limit';
import type { Options } from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../config/env.ts';
import { fail } from '../lib/envelope.ts';

/**
 * Limits from design.md §7. The default in-memory store is correct here — the
 * app is single-process and there is no Redis. A distributed build swaps the
 * store, not these numbers.
 */
const shared: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  // Disabled under test: an integration suite fires hundreds of requests from
  // one address and would trip every limiter.
  skip: () => env.isTest,
  handler: (_req, res) => {
    res.status(429).json(fail('RATE_LIMITED', 'Too many requests. Please slow down.'));
  },
};

/** 10 login attempts per 15 minutes per IP. */
export const loginLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  // Count only failures, so a user with a working password is never locked out
  // by their own successful sign-ins.
  skipSuccessfulRequests: true,
});

/** 100 requests per minute per authenticated user, falling back to IP. */
export const userLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 100,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? 'unknown',
});

/** 1000 requests per minute per device key. */
export const deviceLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 1000,
  keyGenerator: (req: Request) => req.apiKey?.id ?? req.ip ?? 'unknown',
});
