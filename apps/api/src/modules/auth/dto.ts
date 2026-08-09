import { z } from 'zod';
import type { Role, UserDto } from '@mm/shared-types';
import type { Role as RoleModel, User } from '../../db/models/index.ts';

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200, 'Password must be at most 200 characters')
  .regex(/[a-zA-Z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a digit');

export const registerSchema = z.object({
  email: z.string().email('Must be a valid email address').max(255).toLowerCase().trim(),
  password: passwordSchema,
  fullName: z.string().min(2, 'Name must be at least 2 characters').max(120).trim(),
  // Captured at registration even though verification is email-based, because
  // it is required profile data.
  phone: z.string().min(6).max(32).trim().optional(),
});

export const loginSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  // Deliberately not `passwordSchema`: an existing account may predate the
  // current rules, and echoing complexity requirements at sign-in tells an
  // attacker what to generate.
  password: z.string().min(1, 'Password is required').max(200),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

interface UserWithRoles extends User {
  roles?: RoleModel[];
}

export function toUserDto(user: User, roles?: Role[]): UserDto {
  const attached = (user as UserWithRoles).roles;
  const roleNames = roles ?? attached?.map((r) => r.name) ?? [];

  return {
    id: String(user.id),
    email: user.email,
    fullName: user.full_name,
    phone: user.phone ?? null,
    status: user.status,
    roles: roleNames,
    operatorId: user.operator_id === null ? null : String(user.operator_id),
    lastLoginAt: user.last_login_at?.toISOString() ?? null,
    createdAt: user.created_at.toISOString(),
  };
}
