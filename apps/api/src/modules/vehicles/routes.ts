import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.ts';
import { asyncHandler } from '../../middleware/error.ts';
import { requireRole } from '../../middleware/rbac.ts';
import { validate } from '../../middleware/validate.ts';
import {
  getVehicle,
  getVehicleHistory,
  getVehicleMaintenance,
  getVehicles,
  getVehicleTelemetry,
  patchMaintenance,
  patchVehicle,
  patchVehicleStatus,
  postVehicle,
  postVehicleMaintenance,
} from './controller.ts';
import {
  changeStatusSchema,
  createTicketSchema,
  createVehicleSchema,
  historyQuerySchema,
  idParamSchema,
  listVehiclesQuerySchema,
  telemetryQuerySchema,
  updateTicketSchema,
  updateVehicleSchema,
} from './dto.ts';

export const vehicleRoutes = Router();
export const maintenanceRoutes = Router();

vehicleRoutes.use(requireAuth);

// Reads: any authenticated role. Operator-role callers are narrowed to their
// own fleet in the service layer, not here.
vehicleRoutes.get('/', validate({ query: listVehiclesQuerySchema }), asyncHandler(getVehicles));
vehicleRoutes.get('/:id', validate({ params: idParamSchema }), asyncHandler(getVehicle));
vehicleRoutes.get(
  '/:id/status-history',
  validate({ params: idParamSchema, query: historyQuerySchema }),
  asyncHandler(getVehicleHistory),
);
vehicleRoutes.get(
  '/:id/telemetry',
  validate({ params: idParamSchema, query: telemetryQuerySchema }),
  asyncHandler(getVehicleTelemetry),
);
vehicleRoutes.get(
  '/:id/maintenance',
  validate({ params: idParamSchema }),
  asyncHandler(getVehicleMaintenance),
);

// Mutations: operator or admin.
vehicleRoutes.post(
  '/',
  requireRole('operator', 'admin'),
  validate({ body: createVehicleSchema }),
  asyncHandler(postVehicle),
);
vehicleRoutes.patch(
  '/:id',
  requireRole('operator', 'admin'),
  validate({ params: idParamSchema, body: updateVehicleSchema }),
  asyncHandler(patchVehicle),
);
vehicleRoutes.patch(
  '/:id/status',
  requireRole('operator', 'admin'),
  validate({ params: idParamSchema, body: changeStatusSchema }),
  asyncHandler(patchVehicleStatus),
);
vehicleRoutes.post(
  '/:id/maintenance',
  requireRole('operator', 'admin'),
  validate({ params: idParamSchema, body: createTicketSchema }),
  asyncHandler(postVehicleMaintenance),
);

// Mounted separately at /maintenance/:id — a ticket is addressable without
// knowing which vehicle it belongs to.
maintenanceRoutes.use(requireAuth);
maintenanceRoutes.patch(
  '/:id',
  requireRole('operator', 'admin'),
  validate({ params: idParamSchema, body: updateTicketSchema }),
  asyncHandler(patchMaintenance),
);
