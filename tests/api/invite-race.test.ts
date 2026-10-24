import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as passwords from '../../server/auth/password';
import { createWorkspace } from '../../server/lib/accounts';
import { newId } from '../../server/lib/ids';
import { setMailTransport } from '../../server/lib/mailer';
import { resetAuthThrottles } from '../../server/routes/auth';
import { createTestContext, del, post, signIn, type Client, type TestContext } from '../helpers/context';

const OWNER_PASSWORD = 'Synthetic-owner-password-2026';
const INVITEE_PASSWORD = 'Synthetic-invitee-password-2026';
let context: TestContext;
let owner: Client;

beforeEach(async () => {
  context = await createTestContext();
  resetAuthThrottles();
  setMailTransport(async () => ({ sent: true, transport: 'custom' }));
  createWorkspace(context.db, {
    name: 'Synthetic Owner', email: 'race-owner@example.invalid',
    passwordHash: await passwords.hashPassword(OWNER_PASSWORD), organizationName: 'Synthetic Invite Race Org',
  });
  owner = await signIn(context.app, 'race-owner@example.invalid', OWNER_PASSWORD);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setMailTransport(null);
  await context.cleanup();
});

async function invite(role = 'VIEWER') {
  const response = await post(owner, '/api/team/invites').send({ role });
  expect(response.status).toBe(201);
  return { id: response.body.id as string, token: (response.body.url as string).split('/invite/')[1]! };
}

/** Hold bcrypt at its real asynchronous boundary after the first invite read. */
function holdPasswordHash(expectedCalls = 1) {
  let release!: () => void;
  let reached!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { reached = resolve; });
  const original = passwords.hashPassword;
  let calls = 0;
  vi.spyOn(passwords, 'hashPassword').mockImplementation(async (input) => {
    if (input === INVITEE_PASSWORD) {
      calls += 1;
      if (calls === expectedCalls) reached();
      await waiting;
    }
    return original(input);
  });
  return { started, release };
}

function accept(token: string, email: string) {
  return request(context.app).post(`/api/auth/invites/${token}/accept`)
    .send({ name: 'Synthetic Invitee', email, password: INVITEE_PASSWORD })
    .then((response) => response);
}

describe('atomic invitation acceptance after asynchronous password work', () => {
  it('lets only one concurrent account claim an unlocked invitation, without an orphan losing account', async () => {
    const invitation = await invite();
    const gate = holdPasswordHash(2);
    const first = accept(invitation.token, 'race-first@example.invalid');
    const second = accept(invitation.token, 'race-second@example.invalid');
    await gate.started;
    gate.release();

    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 404]);
    expect(context.db.prepare('SELECT COUNT(*) AS n FROM users WHERE email IN (?, ?)')
      .get('race-first@example.invalid', 'race-second@example.invalid')).toEqual({ n: 1 });
    expect(context.db.prepare('SELECT COUNT(*) AS n FROM memberships WHERE org_id = ?')
      .get(owner.session.organization.id)).toEqual({ n: 2 });
    const winner = results.find((result) => result.status === 201)!;
    expect(context.db.prepare('SELECT accepted_by FROM invites WHERE id = ?').get(invitation.id))
      .toEqual({ accepted_by: winner.body.user.id });
  });

  it('honors owner revocation while a new-account acceptance is hashing its password', async () => {
    const invitation = await invite();
    const gate = holdPasswordHash();
    const pending = accept(invitation.token, 'revoked-invitee@example.invalid');
    await gate.started;
    expect((await del(owner, `/api/team/invites/${invitation.id}`)).status).toBe(204);
    gate.release();

    expect((await pending).status).toBe(404);
    expect(context.db.prepare('SELECT id FROM users WHERE email = ?').get('revoked-invitee@example.invalid')).toBeUndefined();
    expect(context.db.prepare('SELECT accepted_at FROM invites WHERE id = ?').get(invitation.id)).toEqual({ accepted_at: null });
  });

  it('honors expiry reached during password hashing without creating an account', async () => {
    const invitation = await invite();
    const expiry = Date.now() + 60_000;
    context.db.prepare('UPDATE invites SET expires_at = ? WHERE id = ?').run(new Date(expiry).toISOString(), invitation.id);
    const gate = holdPasswordHash();
    const pending = accept(invitation.token, 'expired-invitee@example.invalid');
    await gate.started;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(expiry + 1);
    gate.release();

    expect((await pending).status).toBe(404);
    expect(context.db.prepare('SELECT id FROM users WHERE email = ?').get('expired-invitee@example.invalid')).toBeUndefined();
    expect(context.db.prepare('SELECT accepted_at FROM invites WHERE id = ?').get(invitation.id)).toEqual({ accepted_at: null });
  });

  it('rejects an old password changed while an existing-account acceptance is comparing it', async () => {
    const { userId } = createWorkspace(context.db, {
      name: 'Synthetic Existing Invitee', email: 'changed-password@example.invalid',
      passwordHash: await passwords.hashPassword(INVITEE_PASSWORD), organizationName: 'Synthetic Existing Org',
    });
    const invitation = await invite();
    let reached!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { reached = resolve; });
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const original = passwords.verifyPassword;
    vi.spyOn(passwords, 'verifyPassword').mockImplementation(async (input, hash) => {
      if (input === INVITEE_PASSWORD) { reached(); await waiting; }
      return original(input, hash);
    });
    const pending = accept(invitation.token, 'changed-password@example.invalid');
    await started;
    context.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(await passwords.hashPassword('A-new-synthetic-password-2026'), userId);
    release();

    expect((await pending).status).toBe(401);
    expect(context.db.prepare('SELECT id FROM memberships WHERE user_id = ? AND org_id = ?')
      .get(userId, owner.session.organization.id)).toBeUndefined();
    expect(context.db.prepare('SELECT accepted_at FROM invites WHERE id = ?').get(invitation.id)).toEqual({ accepted_at: null });
  });

  it('rolls back the invite claim and new account when the workspace has no editor seats', async () => {
    const orgId = owner.session.organization.id;
    const hash = await passwords.hashPassword(OWNER_PASSWORD);
    for (let index = 0; index < 2; index += 1) {
      const { userId } = createWorkspace(context.db, {
        name: `Synthetic Member ${index}`, email: `seated-${index}@example.invalid`, passwordHash: hash,
        organizationName: `Synthetic Other Org ${index}`,
      });
      context.db.prepare(`INSERT INTO memberships (id, user_id, org_id, role, created_at) VALUES (?, ?, ?, 'MEMBER', ?)`)
        .run(newId('mem'), userId, orgId, new Date().toISOString());
    }
    // Issue on the trial first, then make its three existing editors fill Starter.
    const invitation = await invite('MEMBER');
    context.db.prepare("UPDATE organizations SET plan = 'starter', subscription_status = 'active' WHERE id = ?").run(orgId);

    expect((await accept(invitation.token, 'no-seat-invitee@example.invalid')).status).toBe(402);
    expect(context.db.prepare('SELECT id FROM users WHERE email = ?').get('no-seat-invitee@example.invalid')).toBeUndefined();
    expect(context.db.prepare('SELECT accepted_at, accepted_by FROM invites WHERE id = ?').get(invitation.id))
      .toEqual({ accepted_at: null, accepted_by: null });
  });
});
