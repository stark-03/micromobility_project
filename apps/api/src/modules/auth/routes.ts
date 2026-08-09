import { Router } from 'express';
import { asyncHandler } from '../../middleware/error.ts';
import { loginLimiter } from '../../middleware/rate-limit.ts';
import { validate } from '../../middleware/validate.ts';
import { login, logout, refresh, register } from './controller.ts';
import { loginSchema, registerSchema } from './dto.ts';

export const authRoutes = Router();

authRoutes.post('/register', validate({ body: registerSchema }), asyncHandler(register));

authRoutes.post(
  '/login',
  loginLimiter,
  validate({ body: loginSchema }),
  asyncHandler(login),
);

// No validate(): the token comes from the httpOnly cookie, never the body.
authRoutes.post('/refresh', asyncHandler(refresh));
authRoutes.post('/logout', asyncHandler(logout));
