import request from 'supertest';
import type { Express } from 'express';
import type { Role, UserDto } from '@mm/shared-types';
import { makeUser, TEST_PASSWORD } from './fixtures.ts';
import type { MakeUserOptions } from './fixtures.ts';

export interface Session {
  accessToken: string;
  user: UserDto;
  /** Raw Set-Cookie value; pass straight back via .set('Cookie', …). */
  refreshCookie: string;
  email: string;
  password: string;
  /** Convenience: `Authorization: Bearer <token>`. */
  auth: [string, string];
}

/** Creates a user with the given role and signs them in over real HTTP. */
export async function authAs(
  app: Express,
  role: Role,
  options: Omit<MakeUserOptions, 'role'> = {},
): Promise<Session> {
  const { user, password } = await makeUser({ ...options, role });

  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password });

  if (res.status !== 200) {
    throw new Error(`authAs(${role}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  const setCookie = res.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean);

  return {
    accessToken: res.body.data.accessToken,
    user: res.body.data.user,
    refreshCookie: cookies.join('; '),
    email: user.email,
    password: password ?? TEST_PASSWORD,
    auth: ['Authorization', `Bearer ${res.body.data.accessToken}`],
  };
}
