import { Router } from 'express';
import { adminRoutes } from './modules/admin/routes.ts';
import { authRoutes } from './modules/auth/routes.ts';
import { userRoutes } from './modules/users/routes.ts';

/**
 * The /api/v1 router. Module routers mount here as they land:
 *   Task 17 — vehicles, ingest
 */
export const apiV1 = Router();

apiV1.use('/auth', authRoutes);
apiV1.use('/users', userRoutes);
apiV1.use('/admin', adminRoutes);
