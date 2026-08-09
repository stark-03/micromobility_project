import { Router } from 'express';
import type { Request, Response } from 'express';
import { ok } from '../../lib/envelope.ts';
import { requireApiKey } from '../../middleware/auth.ts';
import { asyncHandler } from '../../middleware/error.ts';
import { deviceLimiter } from '../../middleware/rate-limit.ts';
import { body, validate } from '../../middleware/validate.ts';
import { ingestTelemetrySchema } from './dto.ts';
import type { IngestTelemetryInput } from './dto.ts';
import { ingestTelemetry } from './service.ts';

export const ingestRoutes = Router();

/**
 * Device-only. Authenticated with a scoped API key, never a user session —
 * an IoT gateway has no password and no refresh cookie.
 */
ingestRoutes.post(
  '/telemetry',
  requireApiKey('telemetry:write'),
  deviceLimiter,
  validate({ body: ingestTelemetrySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { readings } = body<IngestTelemetryInput>(req);
    const result = await ingestTelemetry(readings, req.apiKey?.operatorId ?? null);
    res.status(201).json(ok(result));
  }),
);
