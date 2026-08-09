import { Router } from 'express';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../../db/index.ts';
import { ok } from '../../lib/envelope.ts';
import { asyncHandler } from '../../middleware/error.ts';

export const healthRoutes = Router();

/** Liveness. Answers as long as the process is up. */
healthRoutes.get('/healthz', (_req, res) => {
  res.json(ok({ status: 'ok' }));
});

/**
 * Readiness. Checks MySQL.
 *
 * `ml` reports "not_configured" rather than failing: the FastAPI service does
 * not exist until Sprint 3, and a readiness probe that goes red for a component
 * nobody has built yet trains people to ignore it.
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

    const body = ok({ mysql, ml: 'not_configured' as const });
    res.status(mysql === 'ok' ? 200 : 503).json(body);
  }),
);
