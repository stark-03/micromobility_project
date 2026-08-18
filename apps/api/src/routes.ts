import { Router } from 'express';
import { adminRoutes } from './modules/admin/routes.ts';
import { analyticsRoutes } from './modules/analytics/routes.ts';
import { authRoutes } from './modules/auth/routes.ts';
import { chargingRoutes } from './modules/charging/routes.ts';
import { fleetRoutes } from './modules/fleet/routes.ts';
import { geoRoutes } from './modules/geo/routes.ts';
import { ingestRoutes } from './modules/ingest/routes.ts';
import { userRoutes } from './modules/users/routes.ts';
import { trafficIngestRoutes, trafficRoutes } from './modules/traffic/routes.ts';
import { predictionRoutes } from './modules/predictions/routes.ts';
import { routeRoutes } from './modules/routes/routes.ts';
import { runRoutes, simulationRoutes } from './modules/simulation/routes.ts';
import { maintenanceRoutes, vehicleRoutes } from './modules/vehicles/routes.ts';
import { weatherRoutes } from './modules/weather/routes.ts';

/** The /api/v1 router. M01–M05, M11, M12 and M06 (Sprint 4). */
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
apiV1.use('/weather', weatherRoutes);
apiV1.use('/analytics', analyticsRoutes);
apiV1.use('/routes', routeRoutes);
apiV1.use('/predictions', predictionRoutes);
// M06. Runs are addressed independently of their scenario because a run
// monitor deep-link needs one id, not two.
apiV1.use('/scenarios', simulationRoutes);
apiV1.use('/runs', runRoutes);
// M07 fleet optimisation.
apiV1.use('/fleet', fleetRoutes);
// Charging infrastructure + rider-facing proximity lookups.
apiV1.use('/charging', chargingRoutes);
