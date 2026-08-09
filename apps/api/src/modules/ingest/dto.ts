import { z } from 'zod';

/**
 * design.md §7: reject readings timestamped more than 10 minutes in the future
 * or 24 hours in the past. A device with a wrong clock otherwise poisons the
 * training data and can write outside the current partition.
 */
export const MAX_FUTURE_MS = 10 * 60 * 1000;
export const MAX_PAST_MS = 24 * 60 * 60 * 1000;

const readingSchema = z.object({
  vehicleId: z.string().regex(/^\d+$/, 'Must be a numeric vehicle id'),
  recordedAt: z.string().datetime({ message: 'recordedAt must be an ISO-8601 timestamp' }),
  position: z
    .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
    .nullable()
    .optional(),
  speedKph: z.number().min(0).max(200).nullable().optional(),
  batteryPct: z.number().int().min(0).max(100).nullable().optional(),
  odometerM: z.number().int().min(0).nullable().optional(),
  lockState: z.enum(['locked', 'unlocked']).nullable().optional(),
  faultCode: z.string().max(32).nullable().optional(),
  source: z.enum(['gps', 'sensor', 'synthetic']).default('gps'),
});

export const ingestTelemetrySchema = z.object({
  readings: z.array(readingSchema).min(1).max(500),
});

export type Reading = z.infer<typeof readingSchema>;
export type IngestTelemetryInput = z.infer<typeof ingestTelemetrySchema>;
