import { QueryTypes, UniqueConstraintError } from 'sequelize';
import type { VehicleDto, VehicleStatus } from '@mm/shared-types';
import { sequelize } from '../../db/index.ts';
import {
  MaintenanceTicket,
  Vehicle,
  VehicleStatusHistory,
} from '../../db/models/index.ts';
import { pointLiteral, selectGeom } from '../../db/spatial.ts';
import { decodeCursor, encodeCursor } from '../../lib/cursor.ts';
import { AppError } from '../../lib/errors.ts';
import { bus } from '../../realtime/bus.ts';
import { assertTransition } from './state-machine.ts';
import { toHistoryDto, toTelemetryDto, toVehicleDto } from './dto.ts';
import type {
  ChangeStatusInput,
  CreateTicketInput,
  CreateVehicleInput,
  HistoryQuery,
  HistoryRow,
  ListVehiclesQuery,
  TelemetryQuery,
  TelemetryRow,
  UpdateTicketInput,
  UpdateVehicleInput,
  VehicleRow,
} from './dto.ts';

/**
 * Row-level scoping for operator-role callers.
 *
 * requireRole decides WHICH ROLES may call a route; this decides WHICH ROWS
 * they may touch. Keeping them separate is why an operator can call
 * GET /vehicles at all while only ever seeing their own fleet.
 */
export interface Caller {
  id: string;
  roles: string[];
  operatorId: string | null;
}

function operatorScope(caller: Caller): string | null {
  const isOperatorOnly =
    caller.roles.includes('operator') &&
    !caller.roles.includes('admin') &&
    !caller.roles.includes('planner') &&
    !caller.roles.includes('analyst');
  return isOperatorOnly ? caller.operatorId : null;
}

const VEHICLE_SELECT = `
  SELECT v.id, v.operator_id, o.name AS operator_name,
         v.home_zone_id, z.name AS home_zone_name,
         v.external_ref, v.unlock_code, v.station_id, rs.name AS station_name,
         v.type, v.status, v.battery_pct, v.last_seen_at,
         ${selectGeom('v.last_position', 'last_wkt')},
         v.created_at, v.updated_at
  FROM vehicles v
  LEFT JOIN operators o ON o.id = v.operator_id
  LEFT JOIN zones z     ON z.id = v.home_zone_id
  LEFT JOIN rental_stations rs ON rs.id = v.station_id
`;

export interface VehiclePage {
  vehicles: VehicleDto[];
  total: number;
}

export async function listVehicles(
  caller: Caller,
  q: ListVehiclesQuery,
): Promise<VehiclePage> {
  const where: string[] = ['v.deleted_at IS NULL'];
  const reps: unknown[] = [];

  const scoped = operatorScope(caller);
  if (scoped) {
    where.push('v.operator_id = ?');
    reps.push(scoped);
  } else if (q.operatorId) {
    where.push('v.operator_id = ?');
    reps.push(q.operatorId);
  }

  if (q.zoneId) {
    where.push('v.home_zone_id = ?');
    reps.push(q.zoneId);
  }
  if (q.status) {
    where.push('v.status = ?');
    reps.push(q.status);
  }
  if (q.type) {
    where.push('v.type = ?');
    reps.push(q.type);
  }

  const clause = where.join(' AND ');

  const [countRow] = await sequelize.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM vehicles v WHERE ${clause}`,
    { type: QueryTypes.SELECT, replacements: reps },
  );

  const rows = await sequelize.query<VehicleRow>(
    `${VEHICLE_SELECT} WHERE ${clause} ORDER BY v.id ASC LIMIT ? OFFSET ?`,
    { type: QueryTypes.SELECT, replacements: [...reps, q.limit, (q.page - 1) * q.limit] },
  );

  return { vehicles: rows.map(toVehicleDto), total: Number(countRow?.n ?? 0) };
}

export async function getVehicleRow(caller: Caller, id: string): Promise<VehicleRow> {
  const rows = await sequelize.query<VehicleRow>(
    `${VEHICLE_SELECT} WHERE v.id = ? AND v.deleted_at IS NULL`,
    { type: QueryTypes.SELECT, replacements: [id] },
  );
  const row = rows[0];
  // 404 rather than 403 when it belongs to another operator — a 403 would
  // confirm the vehicle exists.
  if (!row) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Vehicle not found');

  const scoped = operatorScope(caller);
  if (scoped && String(row.operator_id) !== String(scoped)) {
    throw AppError.notFound('VEHICLE_NOT_FOUND', 'Vehicle not found');
  }
  return row;
}

export async function createVehicle(
  caller: Caller,
  input: CreateVehicleInput,
): Promise<VehicleDto> {
  const scoped = operatorScope(caller);
  if (scoped && String(input.operatorId) !== String(scoped)) {
    throw AppError.forbidden('You can only register vehicles for your own operator');
  }

  const vehicle = await sequelize.transaction(async (t) => {
    let created: Vehicle;
    try {
      created = await Vehicle.create(
        {
          operator_id: input.operatorId,
          home_zone_id: input.homeZoneId ?? null,
          external_ref: input.externalRef,
          type: input.type,
          status: 'available',
          battery_pct: input.batteryPct ?? null,
        },
        { transaction: t },
      );
    } catch (e) {
      if (e instanceof UniqueConstraintError) {
        throw AppError.conflict(
          'VEHICLE_REF_ALREADY_EXISTS',
          `Operator ${input.operatorId} already has a vehicle with ref "${input.externalRef}"`,
        );
      }
      throw e;
    }

    if (input.position) {
      await sequelize.query(
        `UPDATE vehicles SET last_position = ${pointLiteral(input.position).val as string},
                             last_seen_at = NOW(3)
         WHERE id = ?`,
        { replacements: [created.id], transaction: t },
      );
    }

    // from_status NULL marks the registration row.
    await VehicleStatusHistory.create(
      {
        vehicle_id: created.id,
        from_status: null,
        to_status: 'available',
        reason: 'registered',
        changed_by: caller.id,
      },
      { transaction: t },
    );

    return created;
  });

  // Published only after commit, so no subscriber can observe a vehicle the
  // database does not have.
  bus.emit('vehicle:created', {
    vehicleId: String(vehicle.id),
    operatorId: String(vehicle.operator_id),
    at: new Date().toISOString(),
  });

  const row = await getVehicleRow(caller, String(vehicle.id));
  return toVehicleDto(row);
}

export async function updateVehicle(
  caller: Caller,
  id: string,
  input: UpdateVehicleInput,
): Promise<VehicleDto> {
  await getVehicleRow(caller, id); // scoping + existence

  const vehicle = await Vehicle.findByPk(id);
  if (!vehicle) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Vehicle not found');

  if (input.homeZoneId !== undefined) vehicle.home_zone_id = input.homeZoneId;
  if (input.batteryPct !== undefined) vehicle.battery_pct = input.batteryPct;
  await vehicle.save();

  if (input.position) {
    await sequelize.query(
      `UPDATE vehicles SET last_position = ${pointLiteral(input.position).val as string},
                           last_seen_at = NOW(3)
       WHERE id = ?`,
      { replacements: [id] },
    );
  }

  return toVehicleDto(await getVehicleRow(caller, id));
}

export interface StatusChange {
  vehicle: VehicleDto;
  from: VehicleStatus;
  to: VehicleStatus;
}

export async function changeStatus(
  caller: Caller,
  id: string,
  input: ChangeStatusInput,
): Promise<StatusChange> {
  await getVehicleRow(caller, id);

  const from = await sequelize.transaction(async (t) => {
    // FOR UPDATE so two concurrent transitions cannot both read the same
    // starting status and both write a history row.
    const vehicle = await Vehicle.findByPk(id, { lock: t.LOCK.UPDATE, transaction: t });
    if (!vehicle) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Vehicle not found');

    const current = vehicle.status;
    // Throws INVALID_STATE_TRANSITION, which rolls the transaction back — so an
    // illegal request writes NO history row.
    assertTransition(current, input.to);

    vehicle.status = input.to;
    await vehicle.save({ transaction: t });

    await VehicleStatusHistory.create(
      {
        vehicle_id: id,
        from_status: current,
        to_status: input.to,
        reason: input.reason ?? null,
        changed_by: caller.id,
      },
      { transaction: t },
    );

    return current;
  });

  bus.emit('vehicle:status', {
    vehicleId: String(id),
    from,
    to: input.to,
    at: new Date().toISOString(),
  });

  return { vehicle: toVehicleDto(await getVehicleRow(caller, id)), from, to: input.to };
}

export async function softDeleteVehicle(caller: Caller, id: string): Promise<void> {
  await getVehicleRow(caller, id);
  const vehicle = await Vehicle.findByPk(id);
  await vehicle?.destroy();
}

// ---- status history --------------------------------------------------------

export async function listStatusHistory(
  caller: Caller,
  id: string,
  q: HistoryQuery,
): Promise<{ history: ReturnType<typeof toHistoryDto>[]; nextCursor: string | null }> {
  await getVehicleRow(caller, id);

  const where: string[] = ['h.vehicle_id = ?'];
  const reps: unknown[] = [id];

  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    where.push('(h.changed_at < ? OR (h.changed_at = ? AND h.id < ?))');
    reps.push(c.ts, c.ts, c.id);
  }
  reps.push(q.limit + 1);

  const rows = await sequelize.query<HistoryRow>(
    `SELECT h.id, h.vehicle_id, h.from_status, h.to_status, h.reason,
            h.changed_by, u.full_name AS changed_by_name, h.changed_at
     FROM vehicle_status_history h
     LEFT JOIN users u ON u.id = h.changed_by
     WHERE ${where.join(' AND ')}
     ORDER BY h.changed_at DESC, h.id DESC
     LIMIT ?`,
    { type: QueryTypes.SELECT, replacements: reps },
  );

  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  const last = page[page.length - 1];

  return {
    history: page.map(toHistoryDto),
    nextCursor:
      hasMore && last
        ? encodeCursor({ id: String(last.id), ts: new Date(last.changed_at).toISOString() })
        : null,
  };
}

// ---- telemetry -------------------------------------------------------------

export async function listTelemetry(
  caller: Caller,
  id: string,
  q: TelemetryQuery,
): Promise<{ telemetry: ReturnType<typeof toTelemetryDto>[]; nextCursor: string | null }> {
  await getVehicleRow(caller, id);

  const from = new Date(q.from);
  const to = new Date(q.to);
  if (from.getTime() > to.getTime()) {
    throw AppError.validationFailed([{ path: 'from', message: 'from must be before to' }]);
  }

  // Always bounded by vehicle_id + time so MySQL can prune partitions.
  const where: string[] = ['vehicle_id = ?', 'recorded_at >= ?', 'recorded_at <= ?'];
  const reps: unknown[] = [id, from, to];

  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    where.push('(recorded_at < ? OR (recorded_at = ? AND id < ?))');
    reps.push(new Date(c.ts), new Date(c.ts), c.id);
  }
  reps.push(q.limit + 1);

  const rows = await sequelize.query<TelemetryRow>(
    `SELECT id, vehicle_id, recorded_at, lat, lng, speed_kph, battery_pct,
            odometer_m, lock_state, fault_code, source
     FROM vehicle_telemetry
     WHERE ${where.join(' AND ')}
     ORDER BY recorded_at DESC, id DESC
     LIMIT ?`,
    { type: QueryTypes.SELECT, replacements: reps },
  );

  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  const last = page[page.length - 1];

  return {
    telemetry: page.map(toTelemetryDto),
    nextCursor:
      hasMore && last
        ? encodeCursor({ id: String(last.id), ts: new Date(last.recorded_at).toISOString() })
        : null,
  };
}

// ---- maintenance -----------------------------------------------------------

export async function listTickets(caller: Caller, vehicleId: string): Promise<MaintenanceTicket[]> {
  await getVehicleRow(caller, vehicleId);
  return MaintenanceTicket.findAll({
    where: { vehicle_id: vehicleId },
    order: [['opened_at', 'DESC']],
  });
}

export async function createTicket(
  caller: Caller,
  vehicleId: string,
  input: CreateTicketInput,
): Promise<MaintenanceTicket> {
  const vehicle = await getVehicleRow(caller, vehicleId);

  return MaintenanceTicket.create({
    vehicle_id: vehicleId,
    operator_id: String(vehicle.operator_id),
    reported_by: caller.id,
    assigned_to: input.assignedTo ?? null,
    source: input.source,
    severity: input.severity,
    status: 'open',
    title: input.title,
    description: input.description ?? null,
    fault_code: input.faultCode ?? null,
  });
}

export async function updateTicket(
  caller: Caller,
  ticketId: string,
  input: UpdateTicketInput,
): Promise<MaintenanceTicket> {
  const ticket = await MaintenanceTicket.findByPk(ticketId);
  if (!ticket) {
    throw AppError.notFound('MAINTENANCE_TICKET_NOT_FOUND', 'Maintenance ticket not found');
  }
  // Scoping runs through the vehicle, so an operator cannot touch another
  // operator's tickets.
  await getVehicleRow(caller, String(ticket.vehicle_id));

  if (input.severity !== undefined) ticket.severity = input.severity;
  if (input.assignedTo !== undefined) ticket.assigned_to = input.assignedTo;
  if (input.status !== undefined) {
    ticket.status = input.status;
    ticket.resolved_at =
      input.status === 'resolved' || input.status === 'cancelled' ? new Date() : null;
  }
  await ticket.save();
  return ticket;
}
