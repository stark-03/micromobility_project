import { Router } from 'express';
import { adminRoutes } from './modules/admin/routes.ts';
import { authRoutes } from './modules/auth/routes.ts';
import { geoRoutes } from './modules/geo/routes.ts';
import { ingestRoutes } from './modules/ingest/routes.ts';
import { userRoutes } from './modules/users/routes.ts';
import { trafficIngestRoutes, trafficRoutes } from './modules/traffic/routes.ts';
import { maintenanceRoutes, vehicleRoutes } from './modules/vehicles/routes.ts';

/** The /api/v1 router. M01, M03 (Sprint 1) and M02, M11, M12 (Sprint 2). */
export const apiV1 = Router();

apiV1.use('/auth', authRoutes);
apiV1.use('/users', userRoutes);
apiV1.use('/admin', adminRoutes);
apiV1.use('/vehicles', vehicleRoutes);
apiV1.use('/maintenance', maintenanceRoutes);
apiV1.use('/ingest', ingestRoutes);
apiV1.use('/ingest', trafficIngestRoutes);
apiV1.use('/geo', geoRoutes);
apiV1.use('/traffic', trafficRoutes);
