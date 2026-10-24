import fs from 'node:fs';
import path from 'node:path';

import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { newId } from '../../server/lib/ids';
import { setMailTransport } from '../../server/lib/mailer';
import { resetAuthThrottles } from '../../server/routes/auth';
import { createTestContext, del, post, signIn, type Client, type TestContext } from '../helpers/context';

let context: TestContext;
let sequence = 0;
const password = 'a-long-enough-password';

beforeAll(async () => {
  context = await createTestContext();
  setMailTransport(async () => ({ sent: true, transport: 'custom' }));
});
beforeEach(() => resetAuthThrottles());
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  setMailTransport(null);
  await context.cleanup();
});

async function signUp(): Promise<Client> {
  sequence += 1;
  const agent = request.agent(context.app);
  const response = await agent.post('/api/auth/sign-up').send({
    name: `Erasure Person ${sequence}`,
    email: `erasure-${sequence}@example.org`,
    password,
    organizationName: `Erasure Workspace ${sequence}`,
  });
  expect(response.status).toBe(201);
  return { agent, session: response.body, csrf: response.body.csrfToken };
}

async function addEvidence(owner: Client) {
  expect((await post(owner, '/api/onboarding/sample-data')).status).toBe(201);
  const orgId = owner.session.organization.id;
  const grant = context.db.prepare('SELECT id FROM grants WHERE org_id = ? LIMIT 1').get(orgId) as { id: string };
  const documentId = newId('doc');
  const storageKey = `${orgId}/${documentId}.pdf`;
  const target = path.join(context.uploadsDir, storageKey);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from('%PDF-1.4 synthetic test evidence'));
  context.db.prepare(`INSERT INTO documents (id, org_id, grant_id, uploaded_by, original_name, storage_key, mime_type, size_bytes, created_at)
    VALUES (?, ?, ?, ?, 'synthetic.pdf', ?, 'application/pdf', 32, ?)`)
    .run(documentId, orgId, grant.id, owner.session.user.id, storageKey, new Date().toISOString());
  return { documentId, storageKey, target, grantId: grant.id };
}

function erase(owner: Client) {
  return del(owner, '/api/organization').send({ password, confirmName: owner.session.organization.name });
}

function addAuthenticationArtifacts(userId: string) {
  context.db.prepare('INSERT INTO user_mfa (user_id, encrypted_secret) VALUES (?, ?)').run(userId, 'synthetic-pending-secret');
  context.db.prepare('INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (?, ?)').run(userId, 'synthetic-hash');
  context.db.prepare('INSERT INTO mfa_rate_limits (user_id, window_started, failures) VALUES (?, ?, 2)').run(userId, Date.now());
}

describe('workspace live-data erasure', () => {
  it('erases sole-membership identity, credentials, uploads and local billing copies without logging PII', async () => {
    const owner = await signUp();
    const evidence = await addEvidence(owner);
    const orgId = owner.session.organization.id;
    const userId = owner.session.user.id;
    addAuthenticationArtifacts(userId);
    context.db.prepare(`INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(newId('reset'), userId, newId('token'), '2099-01-01T00:00:00Z', new Date().toISOString());
    context.db.prepare(`INSERT INTO billing_events (id, org_id, type, summary, payload, created_at) VALUES (?, ?, 'test', ?, ?, ?)`)
      .run(newId('billing'), orgId, owner.session.user.email, JSON.stringify({ billingEmail: owner.session.user.email }), new Date().toISOString());
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    expect((await erase(owner)).status).toBe(204);
    expect(context.db.prepare('SELECT id FROM organizations WHERE id = ?').get(orgId)).toBeUndefined();
    expect(context.db.prepare('SELECT id FROM users WHERE id = ?').get(userId)).toBeUndefined();
    expect(context.db.prepare('SELECT id FROM password_resets WHERE user_id = ?').get(userId)).toBeUndefined();
    for (const table of ['user_mfa', 'mfa_recovery_codes', 'mfa_rate_limits']) {
      expect(context.db.prepare(`SELECT 1 FROM ${table} WHERE user_id = ?`).get(userId)).toBeUndefined();
    }
    expect(context.db.prepare('SELECT id FROM billing_events WHERE org_id = ?').get(orgId)).toBeUndefined();
    expect(fs.existsSync(evidence.target)).toBe(false);
    expect((await owner.agent.get('/api/auth/session')).status).toBe(401);
    expect(JSON.stringify(log.mock.calls)).not.toContain(owner.session.user.email);
    expect(JSON.stringify(log.mock.calls)).not.toContain(owner.session.organization.name);
  });

  it('preserves a multi-workspace user and other workspace files, credentials and active sessions', async () => {
    const removed = await signUp();
    const retained = await signUp();
    const evidence = await addEvidence(retained);
    const userId = retained.session.user.id;
    const userBefore = context.db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    context.db.prepare(`INSERT INTO memberships (id, user_id, org_id, role, created_at) VALUES (?, ?, ?, 'MEMBER', ?)`)
      .run(newId('member'), userId, removed.session.organization.id, new Date().toISOString());

    expect((await erase(removed)).status).toBe(204);
    expect(context.db.prepare('SELECT * FROM users WHERE id = ?').get(userId)).toEqual(userBefore);
    expect(context.db.prepare('SELECT id FROM organizations WHERE id = ?').get(retained.session.organization.id)).toBeDefined();
    expect(context.db.prepare('SELECT id FROM documents WHERE id = ?').get(evidence.documentId)).toBeDefined();
    expect(fs.existsSync(evidence.target)).toBe(true);
    expect((await retained.agent.get('/api/auth/session')).status).toBe(200);
    expect((await signIn(context.app, retained.session.user.email, password)).session.user.id).toBe(userId);
  });

  it('erases former-member identity referenced only by the deleted workspace', async () => {
    const owner = await signUp();
    await addEvidence(owner);
    const formerMember = await signUp();
    const userId = formerMember.session.user.id;
    // Simulate a former member whose records remain after membership removal.
    context.db.prepare('DELETE FROM organizations WHERE id = ?').run(formerMember.session.organization.id);
    context.db.prepare('UPDATE documents SET uploaded_by = ? WHERE org_id = ?').run(userId, owner.session.organization.id);

    expect((await erase(owner)).status).toBe(204);
    expect(context.db.prepare('SELECT id FROM users WHERE id = ?').get(userId)).toBeUndefined();
  });

  it('preserves other-workspace evidence using an anonymous inactive stub when an orphan identity is required', async () => {
    const removed = await signUp();
    const other = await signUp();
    const evidence = await addEvidence(other);
    const userId = removed.session.user.id;
    addAuthenticationArtifacts(userId);
    // The removed person formerly uploaded evidence to another controller's workspace.
    context.db.prepare('UPDATE documents SET uploaded_by = ? WHERE id = ?').run(userId, evidence.documentId);
    context.db.prepare(`INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(newId('reset'), userId, newId('token'), '2099-01-01T00:00:00Z', new Date().toISOString());

    expect((await erase(removed)).status).toBe(204);
    const stub = context.db.prepare('SELECT name, email, password_hash, title, is_active, last_sign_in_at FROM users WHERE id = ?').get(userId);
    expect(stub).toMatchObject({ name: 'Deleted user', password_hash: '', title: null, is_active: 0, last_sign_in_at: null });
    expect((stub as { email: string }).email).toMatch(/^deleted-.*@deleted\.invalid$/);
    for (const table of ['sessions', 'password_resets', 'user_mfa', 'mfa_recovery_codes', 'mfa_rate_limits']) {
      expect(context.db.prepare(`SELECT 1 FROM ${table} WHERE user_id = ?`).get(userId)).toBeUndefined();
    }
    expect(context.db.prepare('SELECT id FROM documents WHERE id = ?').get(evidence.documentId)).toBeDefined();
    expect(fs.existsSync(evidence.target)).toBe(true);
    expect((await other.agent.get(`/api/grants/${evidence.grantId}`)).status).toBe(200);
  });

  it('reports failed file erasure, retains metadata and authorization, then permits a successful retry', async () => {
    const owner = await signUp();
    const evidence = await addEvidence(owner);
    const realRemove = fs.rmSync.bind(fs);
    const remove = vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
      if (String(target) === path.join(context.uploadsDir, owner.session.organization.id)) throw Object.assign(new Error('synthetic failure'), { code: 'EACCES' });
      return realRemove(target, options);
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const failed = await erase(owner);
    expect(failed.status).toBe(409);
    expect(failed.body.error.message).toMatch(/incomplete.*Retry/);
    expect(JSON.stringify(failed.body)).not.toContain(context.uploadsDir);
    expect(context.db.prepare('SELECT id FROM organizations WHERE id = ?').get(owner.session.organization.id)).toBeDefined();
    expect(context.db.prepare('SELECT id FROM documents WHERE id = ?').get(evidence.documentId)).toBeDefined();
    expect((await owner.agent.get('/api/auth/session')).status).toBe(200);
    remove.mockRestore();
    expect((await erase(owner)).status).toBe(204);
    expect(fs.existsSync(evidence.target)).toBe(false);
  });

  it('refuses a corrupt cross-tenant storage key before removing any files', async () => {
    const owner = await signUp();
    const other = await signUp();
    const ownEvidence = await addEvidence(owner);
    const otherEvidence = await addEvidence(other);
    context.db.prepare('UPDATE documents SET storage_key = ? WHERE id = ?')
      .run(`${other.session.organization.id}/corrupt-reference.pdf`, ownEvidence.documentId);

    expect((await erase(owner)).status).toBe(409);
    expect(fs.existsSync(ownEvidence.target)).toBe(true);
    expect(fs.existsSync(otherEvidence.target)).toBe(true);
    expect(context.db.prepare('SELECT id FROM organizations WHERE id = ?').get(owner.session.organization.id)).toBeDefined();
  });
});
