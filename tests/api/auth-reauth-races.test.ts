import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as passwords from '../../server/auth/password';
import { totp } from '../../server/auth/mfa';
import { createWorkspace } from '../../server/lib/accounts';
import { setMailTransport } from '../../server/lib/mailer';
import { resetAuthThrottles } from '../../server/routes/auth';
import { createTestContext, post, signIn, type Client, type TestContext } from '../helpers/context';

const PASSWORD = 'Synthetic-auth-race-password-2026';
const EMAIL = 'auth-race@example.invalid';
let context: TestContext;
let client: Client;
let userId: string;
let newPasswordHash: string;

beforeEach(async () => {
  context = await createTestContext();
  resetAuthThrottles();
  setMailTransport(async () => ({ sent: true, transport: 'custom' }));
  ({ userId } = createWorkspace(context.db, {
    name: 'Synthetic Auth Race Owner', email: EMAIL,
    passwordHash: await passwords.hashPassword(PASSWORD), organizationName: 'Synthetic Auth Race Org',
  }));
  newPasswordHash = await passwords.hashPassword('A-new-synthetic-auth-race-password');
  client = await signIn(context.app, EMAIL, PASSWORD);
});

afterEach(async () => {
  vi.restoreAllMocks();
  setMailTransport(null);
  await context.cleanup();
});

function holdVerification() {
  let reached!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { reached = resolve; });
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const original = passwords.verifyPassword;
  vi.spyOn(passwords, 'verifyPassword').mockImplementation(async (password, hash) => {
    reached();
    await waiting;
    return original(password, hash);
  });
  return { started, release };
}

type ConcurrentChange = 'password changed' | 'account deactivated' | 'session revoked';
function changeAccount(change: ConcurrentChange) {
  if (change === 'password changed') context.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newPasswordHash, userId);
  else if (change === 'account deactivated') context.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(userId);
  else context.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function sessionCount() {
  return (context.db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(userId) as { count: number }).count;
}

async function enroll(): Promise<string> {
  const setup = await post(client, '/api/auth/mfa/setup').send({ password: PASSWORD });
  expect(setup.status).toBe(200);
  const enabled = await post(client, '/api/auth/mfa/enable').send({ code: totp(setup.body.secret) });
  expect(enabled.status).toBe(200);
  client.csrf = enabled.body.csrfToken;
  return enabled.body.recoveryCodes[0] as string;
}

describe('sign-in verifies current account state after asynchronous bcrypt', () => {
  it.each(['password changed', 'account deactivated'] as const)('rejects a login when %s during verification', async (change) => {
    const before = sessionCount();
    const gate = holdVerification();
    const pending = request(context.app).post('/api/auth/sign-in').send({ email: EMAIL, password: PASSWORD }).then((response) => response);
    await gate.started;
    changeAccount(change);
    gate.release();

    const response = await pending;
    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(sessionCount()).toBe(before);
  });
});

describe('MFA management revalidates password and session after asynchronous bcrypt', () => {
  for (const operation of ['setup', 'disable', 'recovery-codes'] as const) {
    it.each(['password changed', 'account deactivated', 'session revoked'] as const)(`${operation} refuses to change security settings when %s during reauthentication`, async (change) => {
      const code = operation === 'setup' ? '' : await enroll();
      const stateBefore = context.db.prepare('SELECT * FROM user_mfa WHERE user_id = ?').get(userId);
      const recoveryBefore = context.db.prepare('SELECT * FROM mfa_recovery_codes WHERE user_id = ? ORDER BY code_hash').all(userId);
      const gate = holdVerification();
      const pending = post(client, `/api/auth/mfa/${operation}`).send({ password: PASSWORD, code }).then((response) => response);
      await gate.started;
      changeAccount(change);
      const sessionsAfterChange = sessionCount();
      gate.release();

      const response = await pending;
      expect(response.status).toBe(401);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.body.secret).toBeUndefined();
      expect(response.body.recoveryCodes).toBeUndefined();
      expect(context.db.prepare('SELECT * FROM user_mfa WHERE user_id = ?').get(userId)).toEqual(stateBefore);
      expect(context.db.prepare('SELECT * FROM mfa_recovery_codes WHERE user_id = ? ORDER BY code_hash').all(userId)).toEqual(recoveryBefore);
      expect(sessionCount()).toBe(sessionsAfterChange);
    });
  }
});
