import type { Request, Response } from 'express';
import { ok } from '../../lib/envelope.ts';
import { AppError } from '../../lib/errors.ts';
import { body, params, query } from '../../middleware/validate.ts';
import { AUDIT, record } from '../audit/service.ts';
import { toTicketDto, toVehicleDto } from './dto.ts';
import type {
  ChangeStatusInput,
  CreateTicketInput,
  CreateVehicleInput,
  HistoryQuery,
  ListVehiclesQuery,
  TelemetryQuery,
  UpdateTicketInput,
  UpdateVehicleInput,
} from './dto.ts';
import type { Caller } from './service.ts';
import {
  changeStatus,
  createTicket,
  createVehicle,
  getVehicleRow,
  listStatusHistory,
  listTelemetry,
  listTickets,
  listVehicles,
  updateTicket,
  updateVehicle,
} from './service.ts';

function caller(req: Request): Caller {
  if (!req.user) throw AppError.unauthenticated();
  return { id: req.user.id, roles: req.user.roles, operatorId: req.user.operatorId };
}

export async function getVehicles(req: Request, res: Response): Promise<void> {
  const q = query<ListVehiclesQuery>(req);
  const page = await listVehicles(caller(req), q);
  res.json(ok(page.vehicles, { page: q.page, limit: q.limit, total: page.total }));
}

export async function getVehicle(req: Request, res: Response): Promise<void> {
  const { id } = params<{ id: string }>(req);
  res.json(ok(toVehicleDto(await getVehicleRow(caller(req), id))));
}

export async function postVehicle(req: Request, res: Response): Promise<void> {
  const c = caller(req);
  const vehicle = await createVehicle(c, body<CreateVehicleInput>(req));

  await record({
    actorType: 'user',
    actorId: c.id,
    action: AUDIT.VEHICLE_CREATED,
    subjectType: 'vehicle',
    subjectId: vehicle.id,
    metadata: { externalRef: vehicle.externalRef, type: vehicle.type },
    ip: req.ip,
  });

  res.status(201).json(ok(vehicle));
}

export async function patchVehicle(req: Request, res: Response): Promise<void> {
  const c = caller(req);
  const { id } = params<{ id: string }>(req);
  const vehicle = await updateVehicle(c, id, body<UpdateVehicleInput>(req));

  await record({
    actorType: 'user',
    actorId: c.id,
    action: AUDIT.VEHICLE_UPDATED,
    subjectType: 'vehicle',
    subjectId: id,
    ip: req.ip,
  });

  res.json(ok(vehicle));
}

export async function patchVehicleStatus(req: Request, res: Response): Promise<void> {
  const c = caller(req);
  const { id } = params<{ id: string }>(req);
  const input = body<ChangeStatusInput>(req);
  const change = await changeStatus(c, id, input);

  await record({
    actorType: 'user',
    actorId: c.id,
    action: AUDIT.VEHICLE_STATUS_CHANGED,
    subjectType: 'vehicle',
    subjectId: id,
    metadata: { from: change.from, to: change.to, reason: input.reason ?? null },
    ip: req.ip,
  });

  res.json(ok(change.vehicle));
}

export async function getVehicleHistory(req: Request, res: Response): Promise<void> {
  const { id } = params<{ id: string }>(req);
  const q = query<HistoryQuery>(req);
  const page = await listStatusHistory(caller(req), id, q);
  res.json(ok(page.history, { limit: q.limit, nextCursor: page.nextCursor }));
}

export async function getVehicleTelemetry(req: Request, res: Response): Promise<void> {
  const { id } = params<{ id: string }>(req);
  const q = query<TelemetryQuery>(req);
  const page = await listTelemetry(caller(req), id, q);
  res.json(ok(page.telemetry, { limit: q.limit, nextCursor: page.nextCursor }));
}

export async function getVehicleMaintenance(req: Request, res: Response): Promise<void> {
  const { id } = params<{ id: string }>(req);
  const tickets = await listTickets(caller(req), id);
  res.json(ok(tickets.map(toTicketDto)));
}

export async function postVehicleMaintenance(req: Request, res: Response): Promise<void> {
  const { id } = params<{ id: string }>(req);
  const ticket = await createTicket(caller(req), id, body<CreateTicketInput>(req));
  res.status(201).json(ok(toTicketDto(ticket)));
}

export async function patchMaintenance(req: Request, res: Response): Promise<void> {
  const { id } = params<{ id: string }>(req);
  const ticket = await updateTicket(caller(req), id, body<UpdateTicketInput>(req));
  res.json(ok(toTicketDto(ticket)));
}
