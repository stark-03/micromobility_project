import type { Request, Response } from 'express';
import { ok } from '../../lib/envelope.ts';
import { AppError } from '../../lib/errors.ts';
import { body, params, query } from '../../middleware/validate.ts';
import { AUDIT, record } from '../audit/service.ts';
import { toApiKeyDto } from './dto.ts';
import type { CreateApiKeyInput, ListUsersQuery, SetRolesInput } from './dto.ts';
import {
  createApiKey,
  listApiKeys,
  listUsers,
  revokeApiKey,
  setRoles,
} from './service.ts';

function actor(req: Request): string {
  if (!req.user) throw AppError.unauthenticated();
  return req.user.id;
}

export async function getUsers(req: Request, res: Response): Promise<void> {
  const q = query<ListUsersQuery>(req);
  const page = await listUsers(q);
  res.json(ok(page.users, { page: q.page, limit: q.limit, total: page.total }));
}

export async function patchUserRoles(req: Request, res: Response): Promise<void> {
  const { id } = params<{ id: string }>(req);
  const { roles } = body<SetRolesInput>(req);
  const change = await setRoles(id, roles);

  await record({
    actorType: 'user',
    actorId: actor(req),
    action: AUDIT.ROLES_CHANGED,
    subjectType: 'user',
    subjectId: id,
    // Both sides recorded: "who has admin now" is answerable from the trail
    // alone, without replaying the current table.
    metadata: { before: change.before, after: change.after },
    ip: req.ip,
  });

  res.json(ok(change.user));
}

export async function getApiKeys(_req: Request, res: Response): Promise<void> {
  const keys = await listApiKeys();
  res.json(ok(keys.map(toApiKeyDto)));
}

export async function postApiKey(req: Request, res: Response): Promise<void> {
  const input = body<CreateApiKeyInput>(req);
  const { record: key, raw } = await createApiKey(actor(req), input);

  await record({
    actorType: 'user',
    actorId: actor(req),
    action: AUDIT.API_KEY_CREATED,
    subjectType: 'api_key',
    subjectId: key.id,
    metadata: { name: key.name, scopes: input.scopes },
    ip: req.ip,
  });

  // `key` is present ONLY in this response. It is never readable again.
  res.status(201).json(ok({ ...toApiKeyDto(key), key: raw }));
}

export async function deleteApiKey(req: Request, res: Response): Promise<void> {
  const { id } = params<{ id: string }>(req);
  const key = await revokeApiKey(id);

  await record({
    actorType: 'user',
    actorId: actor(req),
    action: AUDIT.API_KEY_REVOKED,
    subjectType: 'api_key',
    subjectId: id,
    ip: req.ip,
  });

  res.json(ok(toApiKeyDto(key)));
}
