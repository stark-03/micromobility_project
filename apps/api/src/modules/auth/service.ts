import bcrypt from 'bcryptjs';
import type { Role as RoleName } from '@mm/shared-types';
import { sequelize } from '../../db/index.ts';
import { Role, User, UserPreference, UserRole } from '../../db/models/index.ts';
import { AppError } from '../../lib/errors.ts';
import type { RegisterInput } from './dto.ts';

/** design.md §7. Cost 12 is ~250 ms on this hardware — deliberate. */
export const BCRYPT_COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Self-registration always grants `commuter` and nothing else. Elevated roles
 * come only from PATCH /admin/users/:id/roles.
 */
export const SELF_REGISTRATION_ROLE: RoleName = 'commuter';

export async function registerUser(input: RegisterInput): Promise<User> {
  const existing = await User.findOne({
    where: { email: input.email },
    paranoid: false,
  });
  if (existing) {
    throw AppError.conflict('EMAIL_ALREADY_REGISTERED', 'That email is already registered');
  }

  return sequelize.transaction(async (t) => {
    const user = await User.create(
      {
        email: input.email,
        password_hash: await hashPassword(input.password),
        full_name: input.fullName,
        phone: input.phone ?? null,
        status: 'active',
      },
      { transaction: t },
    );

    const role = await Role.findOne({
      where: { name: SELF_REGISTRATION_ROLE },
      transaction: t,
    });
    if (!role) {
      throw new Error(
        `Role "${SELF_REGISTRATION_ROLE}" is missing. Run npm run db:seed before registering.`,
      );
    }

    await UserRole.create({ user_id: user.id, role_id: role.id }, { transaction: t });
    await UserPreference.create({ user_id: user.id }, { transaction: t });

    return user;
  });
}

export interface AuthenticatedUser {
  user: User;
  roles: RoleName[];
}

export async function authenticate(email: string, password: string): Promise<AuthenticatedUser> {
  const user = await User.findOne({
    where: { email },
    include: [{ model: Role, as: 'roles' }],
  });

  // Always run a bcrypt comparison, even when no user matched, so response time
  // does not reveal whether an address is registered.
  const hash = user?.password_hash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const matches = await verifyPassword(password, hash);

  if (!user || !matches) {
    throw new AppError('INVALID_CREDENTIALS', 'That email and password do not match');
  }
  if (user.status !== 'active') {
    throw AppError.forbidden(`Account is ${user.status}`);
  }

  const roles = ((user as User & { roles?: Role[] }).roles ?? []).map((r) => r.name);
  return { user, roles };
}

export async function markLogin(user: User): Promise<void> {
  user.last_login_at = new Date();
  await user.save({ fields: ['last_login_at'] });
}

export async function getUserRoles(userId: string): Promise<RoleName[]> {
  const rows = await UserRole.findAll({ where: { user_id: userId } });
  const roles = await Role.findAll();
  const nameById = new Map(roles.map((r) => [r.id, r.name]));
  return rows.map((r) => nameById.get(r.role_id)!).filter(Boolean);
}
