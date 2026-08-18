import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import { env } from './config/env.ts';
import { ensureModels } from './db/models/index.ts';
import { registerJobs } from './jobs/register.ts';
import { errorHandler, notFoundHandler } from './middleware/error.ts';
import { userLimiter } from './middleware/rate-limit.ts';
import { gbfsRoutes } from './modules/gbfs/routes.ts';
import { healthRoutes } from './modules/health/routes.ts';
import { apiV1 } from './routes.ts';

/**
 * Builds the Express app WITHOUT calling listen, so Supertest can mount it.
 * server.ts is the only file that binds a port.
 */
export function createApp(): Express {
  ensureModels();
  registerJobs();

  const app = express();

  // Behind a proxy in any real deployment; needed for correct req.ip in limiters.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    cors({
      origin: env.corsOrigin,
      // The refresh token is an httpOnly cookie, so the browser must be allowed
      // to send it cross-origin from the Vite dev server.
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Health checks sit outside the limiter — a probe must never be throttled.
  app.use(healthRoutes);
  // M15. Public and unauthenticated by the standard's design — mounted
  // outside /api/v1 so no auth middleware sits in its path.
  app.use(`/gbfs/2.3`, gbfsRoutes);

  app.use('/api/v1', userLimiter, apiV1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
