import { QueryTypes } from 'sequelize';
import { sequelize } from '../../db/index.ts';
import { AppError } from '../../lib/errors.ts';
import { MAX_FUTURE_MS, MAX_PAST_MS } from './dto.ts';
import type { Reading } from './dto.ts';

export interface IngestResult {
  accepted: number;
  rejected: Array<{ index: number; reason: string }>;
  vehiclesUpdated: number;
}

/**
 * Batch telemetry ingest.
 *
 * Partial acceptance is deliberate: a gateway uploading 500 readings should not
 * lose all of them because one had a bad clock. The response names every
 * rejected index and why, so the device can correct and retry.
 */
export async function ingestTelemetry(
  readings: Reading[],
  operatorId: string | null,
): Promise<IngestResult> {
  const now = Date.now();
  const rejected: Array<{ index: number; reason: string }> = [];
  const accepted: Reading[] = [];

  // Only vehicles that exist, are not deleted, and (for a scoped key) belong to
  // the key's operator.
  const ids = [...new Set(readings.map((r) => r.vehicleId))];
  const known = await sequelize.query<{ id: string; operator_id: string }>(
    `SELECT id, operator_id FROM vehicles WHERE id IN (?) AND deleted_at IS NULL`,
    { type: QueryTypes.SELECT, replacements: [ids] },
  );
  const operatorByVehicle = new Map(known.map((v) => [String(v.id), String(v.operator_id)]));

  readings.forEach((r, index) => {
    const owner = operatorByVehicle.get(r.vehicleId);
    if (!owner) {
      rejected.push({ index, reason: 'Unknown vehicle' });
      return;
    }
    if (operatorId !== null && owner !== String(operatorId)) {
      // Same message as unknown: a scoped key must not be able to enumerate
      // another operator's vehicle ids by watching the error change.
      rejected.push({ index, reason: 'Unknown vehicle' });
      return;
    }

    const ts = new Date(r.recordedAt).getTime();
    if (ts - now > MAX_FUTURE_MS) {
      rejected.push({ index, reason: 'recordedAt is more than 10 minutes in the future' });
      return;
    }
    if (now - ts > MAX_PAST_MS) {
      rejected.push({ index, reason: 'recordedAt is more than 24 hours in the past' });
      return;
    }

    accepted.push(r);
  });

  if (accepted.length === 0) {
    return { accepted: 0, rejected, vehiclesUpdated: 0 };
  }

  const placeholders: string[] = [];
  const reps: unknown[] = [];
  for (const r of accepted) {
    placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    reps.push(
      r.vehicleId,
      new Date(r.recordedAt),
      r.position ? r.position[1] : null, // lat
      r.position ? r.position[0] : null, // lng
      r.speedKph ?? null,
      r.batteryPct ?? null,
      r.odometerM ?? null,
      r.lockState ?? null,
      r.faultCode ?? null,
      r.source,
    );
  }

  const latestByVehicle = new Map<string, Reading>();
  for (const r of accepted) {
    const seen = latestByVehicle.get(r.vehicleId);
    if (!seen || new Date(r.recordedAt) > new Date(seen.recordedAt)) {
      latestByVehicle.set(r.vehicleId, r);
    }
  }

  await sequelize.transaction(async (t) => {
    await sequelize.query(
      `INSERT INTO vehicle_telemetry
         (vehicle_id, recorded_at, lat, lng, speed_kph, battery_pct, odometer_m,
          lock_state, fault_code, source)
       VALUES ${placeholders.join(',')}`,
      { replacements: reps, transaction: t },
    );

    // Roll the vehicle's summary fields forward from its newest reading only.
    for (const [vehicleId, r] of latestByVehicle) {
      await sequelize.query(
        `UPDATE vehicles
         SET battery_pct  = COALESCE(?, battery_pct),
             last_seen_at = GREATEST(COALESCE(last_seen_at, ?), ?)
         WHERE id = ?`,
        {
          replacements: [
            r.batteryPct ?? null,
            new Date(r.recordedAt),
            new Date(r.recordedAt),
            vehicleId,
          ],
          transaction: t,
        },
      );
    }
  });

  return { accepted: accepted.length, rejected, vehiclesUpdated: latestByVehicle.size };
}

export function assertHasReadings(count: number): void {
  if (count === 0) {
    throw AppError.validationFailed([{ path: 'readings', message: 'At least one reading required' }]);
  }
}
