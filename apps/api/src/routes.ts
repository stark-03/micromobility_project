import { Router } from 'express';
import { adminRoutes } from './modules/admin/routes.ts';
import { authRoutes } from './modules/auth/routes.ts';
import { ingestRoutes } from './modules/ingest/routes.ts';
import { userRoutes } from './modules/users/routes.ts';
import { maintenanceRoutes, vehicleRoutes } from './modules/vehicles/routes.ts';

/** The /api/v1 router. Sprint 1 mounts M01 and M03. */
export const apiV1 = Router();

apiV1.use('/auth', authRoutes);
apiV1.use('/users', userRoutes);
apiV1.use('/admin', adminRoutes);
apiV1.use('/vehicles', vehicleRoutes);
apiV1.use('/maintenance', maintenanceRoutes);
apiV1.use('/ingest', ingestRoutes);
