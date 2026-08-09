import { Router } from 'express';
import { authRoutes } from './modules/auth/routes.ts';

/**
 * The /api/v1 router. Module routers mount here as they land:
 *   Task 14 — users       Task 15 — admin
 *   Task 17 — vehicles, ingest
 */
export const apiV1 = Router();

apiV1.use('/auth', authRoutes);
