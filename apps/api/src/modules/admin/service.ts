import crypto from 'node:crypto';
import { Op } from 'sequelize';
import type { Role as RoleName, UserDto } from '@mm/shared-types';
import { sequelize } from '../../db/index.ts';
import { ApiKey, Role, User, UserRole } from '../../db/models/index.ts';
import { AppError } from '../../lib/errors.ts';
import { hashApiKey } from '../../middleware/auth.ts';
import { toUserDto } from '../auth/dto.ts';
import type { CreateApiKeyInput, ListUsersQuery } from './dto.ts';

export interface UserPage {
  users: UserDto[];
  total: number;
}

export async function listUsers(q: ListUsersQuery): Promise<UserPage> {
  const where: Record<string | symbol, unknown> = {};
  if (q.status) where.status = q.status;
  if (q.q) {
    where[Op.or as unknown as string] = [
      { email: { [Op.like]: `${q.q}%` } },
      { full_name: { [Op.like]: `${q.q}%` } },
    ];
  }

  const include = q.role
    ? [{ model: Role, as: 'roles', where: { name: q.role }, required: true }]
    : [{ model: Role, as: 'roles' }];

  // Offset pagination: this is an admin table, per the CLAUDE.md rule that
  // cursors are for feeds and offsets for admin tables.
  const { rows, count } = await User.findAndCountAll({
    where,
    include,
    order: [['created_at', 'DESC']],
    limit: q.limit,
    offset: (q.page - 1) * q.limit,
    distinct: true,
  });

  return { users: rows.map((u) => toUserDto(u)), total: count };
}

export interface RoleChange {
  user: UserDto;
  before: RoleName[];
  after: RoleName[];
}

export async function setRoles(userId: string, next: RoleName[]): Promise<RoleChange> {
  const user = await User.findByPk(userId, { include: [{ model: Role, as: 'roles' }] });
  if (!user) throw AppError.notFound('USER_NOT_FOUND', 'User not found');

  const before = ((user as User & { roles?: Role[] }).roles ?? []).map((r) => r.name);
  const unique = [...new Set(next)];

  // Refuse to remove the last admin. Without this an admin can lock every
  // human out of the platform with a single well-formed request.
  if (before.includes('admin') && !unique.includes('admin')) {
    const adminRole = await Role.findOne({ where: { name: 'admin' } });
    const adminCount = adminRole
      ? await UserRole.count({ where: { role_id: adminRole.id } })
      : 0;
    if (adminCount <= 1) {
      throw AppError.conflict(
        'LAST_ADMIN_PROTECTED',
        'Refusing to remove the last admin — promote another user first',
      );
    }
  }

  await sequelize.transaction(async (t) => {
    const all = await Role.findAll({ transaction: t });
    const idByName = new Map(all.map((r) => [r.name, r.id]));

    await UserRole.destroy({ where: { user_id: userId }, transaction: t });
    for (const name of unique) {
      const roleId = idByName.get(name);
      if (!roleId) throw new Error(`Role "${name}" is not seeded`);
      await UserRole.create({ user_id: userId, role_id: roleId }, { transaction: t });
    }
  });

  const fresh = await User.findByPk(userId, { include: [{ model: Role, as: 'roles' }] });
  return { user: toUserDto(fresh!), before, after: unique };
}

// ---- API keys --------------------------------------------------------------

export interface GeneratedApiKey {
  raw: string;
  prefix: string;
  hash: string;
}

/** `mm_<8-char prefix>_<43-char secret>`. */
export function generateApiKey(): GeneratedApiKey {
  const prefix = crypto.randomBytes(6).toString('base64url').slice(0, 8);
  const secret = crypto.randomBytes(32).toString('base64url');
  const raw = `mm_${prefix}_${secret}`;
  return { raw, prefix, hash: hashApiKey(raw) };
}

export async function listApiKeys(): Promise<ApiKey[]> {
  return ApiKey.findAll({ order: [['created_at', 'DESC']] });
}

export async function createApiKey(
  createdBy: string,
  input: CreateApiKeyInput,
): Promise<{ record: ApiKey; raw: string }> {
  const { raw, prefix, hash } = generateApiKey();
  const record = await ApiKey.create({
    name: input.name,
    key_prefix: prefix,
    key_hash: hash,
    scopes: input.scopes,
    operator_id: input.operatorId ?? null,
    created_by: createdBy,
    expires_at: input.expiresAt ? new Date(input.expiresAt) : null,
  });
  // `raw` is returned to the caller exactly once and never stored.
  return { record, raw };
}

export async function revokeApiKey(id: string): Promise<ApiKey> {
  const key = await ApiKey.findByPk(id);
  if (!key) throw AppError.notFound('USER_NOT_FOUND', 'API key not found');
  key.revoked_at = new Date();
  await key.save();
  return key;
}
