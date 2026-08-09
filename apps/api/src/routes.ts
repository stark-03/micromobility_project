import { Router } from 'express';
import { authRoutes } from './modules/auth/routes.ts';
import { userRoutes } from './modules/users/routes.ts';

/**
 * The /api/v1 router. Module routers mount here as they land:
 *   Task 15 — admin       Task 17 — vehicles, ingest
 */
export const apiV1 = Router();

apiV1.use('/auth', authRoutes);
apiV1.use('/users', userRoutes);
