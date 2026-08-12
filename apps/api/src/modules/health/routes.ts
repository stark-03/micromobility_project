import { Router } from 'express';
import { QueryTypes } from 'sequelize';
import { env } from '../../config/env.ts';
import { sequelize } from '../../db/index.ts';
import { ok } from '../../lib/envelope.ts';
import { asyncHandler } from '../../middleware/error.ts';

export const healthRoutes = Router();

/** Liveness. Answers as long as the process is up. */
healthRoutes.get('/healthz', (_req, res) => {
  res.json(ok({ status: 'ok' }));
});

/**
 * Readiness. Checks MySQL and the ML service.
 *
 * The ML service exists as of Sprint 3, so it is probed for real. It is still
 * not fatal: routing degrades, but the live map, the fleet and everything else
 * keep working, and a probe that goes red for a partial outage teaches people
 * to ignore it.
 */
healthRoutes.get(
  '/readyz',
  asyncHandler(async (_req, res) => {
    let mysql: 'ok' | 'down' = 'ok';
    try {
      await sequelize.query('SELECT 1', { type: QueryTypes.SELECT });
    } catch {
      mysql = 'down';
    }

    let ml: 'ok' | 'down' | 'not_configured' = 'not_configured';
    if (env.mlServiceUrl) {
      try {
        const probe = await fetch(`${env.mlServiceUrl}/healthz`, {
          signal: AbortSignal.timeout(2000),
        });
        ml = probe.ok ? 'ok' : 'down';
      } catch {
        ml = 'down';
      }
    }

    res.status(mysql === 'ok' ? 200 : 503).json(ok({ mysql, ml }));
  }),
);
