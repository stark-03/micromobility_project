import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.ts';
import { asyncHandler } from '../../middleware/error.ts';
import { requireRole } from '../../middleware/rbac.ts';
import { validate } from '../../middleware/validate.ts';
import {
  deleteApiKey,
  getApiKeys,
  getUsers,
  patchUserRoles,
  postApiKey,
} from './controller.ts';
import {
  createApiKeySchema,
  idParamSchema,
  listUsersQuerySchema,
  setRolesSchema,
} from './dto.ts';

export const adminRoutes = Router();

// Admin only, whole surface. Defence in depth: the guard here, plus service
// checks such as "refuse to remove the last admin".
adminRoutes.use(requireAuth, requireRole('admin'));

adminRoutes.get('/users', validate({ query: listUsersQuerySchema }), asyncHandler(getUsers));
adminRoutes.patch(
  '/users/:id/roles',
  validate({ params: idParamSchema, body: setRolesSchema }),
  asyncHandler(patchUserRoles),
);

adminRoutes.get('/api-keys', asyncHandler(getApiKeys));
adminRoutes.post('/api-keys', validate({ body: createApiKeySchema }), asyncHandler(postApiKey));
adminRoutes.delete(
  '/api-keys/:id',
  validate({ params: idParamSchema }),
  asyncHandler(deleteApiKey),
);
