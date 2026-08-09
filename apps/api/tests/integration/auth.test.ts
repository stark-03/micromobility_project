import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.ts';
import { AuditLog } from '../../src/db/models/index.ts';
import { REFRESH_COOKIE } from '../../src/modules/auth/controller.ts';
import { useCleanDatabase } from '../helpers/clean-db.ts';
import { authAs } from '../helpers/auth-as.ts';
import { makeUser, TEST_PASSWORD } from '../helpers/fixtures.ts';

useCleanDatabase();
const app = createApp();

const NEW_USER = {
  email: 'newrider@belagavi.local',
  password: 'Belagavi2026rides',
  fullName: 'New Rider',
};

function cookieOf(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [raw].filter(Boolean);
  return cookies.join('; ');
}

describe('POST /auth/register', () => {
  it('creates the account, returns a token, and sets an httpOnly cookie', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(NEW_USER);

    expect(res.status).toBe(201);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user.email).toBe(NEW_USER.email);

    const cookie = cookieOf(res);
    expect(cookie).toContain(REFRESH_COOKIE);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    // Path-scoped so it never rides along on ordinary API calls.
    expect(cookie).toContain('Path=/api/v1/auth');
  });

  it('grants commuter and nothing else', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(NEW_USER);
    expect(res.body.data.user.roles).toEqual(['commuter']);
  });

  it('never returns the password or its hash', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(NEW_USER);
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain(NEW_USER.password);
    expect(serialised).not.toContain('password_hash');
  });

  it('rejects a duplicate email with EMAIL_ALREADY_REGISTERED', async () => {
    await request(app).post('/api/v1/auth/register').send(NEW_USER);
    const res = await request(app).post('/api/v1/auth/register').send(NEW_USER);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('rejects a weak password with per-field detail', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...NEW_USER, password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.some((d: { path: string }) => d.path === 'password')).toBe(true);
  });

  it('rejects a malformed email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...NEW_USER, email: 'not-an-email' });
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /auth/login', () => {
  it('signs in with correct credentials', async () => {
    const { user } = await makeUser({ role: 'planner' });
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.user.roles).toEqual(['planner']);
    expect(cookieOf(res)).toContain(REFRESH_COOKIE);
  });

  it('rejects a wrong password with INVALID_CREDENTIALS', async () => {
    const { user } = await makeUser({ role: 'commuter' });
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'wrong-password-1' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('gives an unknown email the same code as a wrong password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@belagavi.local', password: 'whatever-123' });

    // Must not reveal whether the address is registered.
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('refuses a suspended account', async () => {
    const { user } = await makeUser({ role: 'commuter', status: 'suspended' });
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('records both success and failure in the audit log', async () => {
    const { user } = await makeUser({ role: 'commuter' });
    await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'nope-12345' });
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });

    const actions = (await AuditLog.findAll()).map((a) => a.action);
    expect(actions).toContain('auth.login.failure');
    expect(actions).toContain('auth.login.success');
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the cookie and issues a fresh access token', async () => {
    const session = await authAs(app, 'commuter');

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', session.refreshCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    // The new cookie must differ, or nothing rotated.
    expect(cookieOf(res)).not.toBe(session.refreshCookie);
  });

  it('rejects a request with no cookie', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('replaying a spent cookie returns REFRESH_TOKEN_REUSED and clears it', async () => {
    const session = await authAs(app, 'commuter');
    await request(app).post('/api/v1/auth/refresh').set('Cookie', session.refreshCookie);

    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', session.refreshCookie);

    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    expect(cookieOf(replay)).toContain(`${REFRESH_COOKIE}=;`);

    const actions = (await AuditLog.findAll()).map((a) => a.action);
    expect(actions).toContain('auth.refresh.reuse_detected');
  });

  it('ignores a refresh token supplied in the body', async () => {
    const session = await authAs(app, 'commuter');
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshCookie });

    // Only the httpOnly cookie counts.
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('clears the cookie and kills the family', async () => {
    const session = await authAs(app, 'commuter');

    const out = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', session.refreshCookie)
      .set(...session.auth);

    expect(out.status).toBe(200);
    expect(cookieOf(out)).toContain(`${REFRESH_COOKIE}=;`);

    const after = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', session.refreshCookie);
    expect(after.status).toBe(401);
  });

  it('is harmless without a cookie', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(200);
  });
});
