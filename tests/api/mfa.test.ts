import crypto from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { vi.stubEnv('RESEND_API_KEY', ''); });
import { createTestContext, signIn, type TestContext, type Client } from '../helpers/context';
import { hashPassword } from '../../server/auth/password';
import { createWorkspace, issuePasswordReset } from '../../server/lib/accounts';
import { base32, totp, verifyMfa } from '../../server/auth/mfa';
import { createSession, encodeCookie } from '../../server/auth/session';
import { config } from '../../server/config';
import { resetAuthThrottles } from '../../server/routes/auth';
import { setMailTransport } from '../../server/lib/mailer';

const PASSWORD = 'Synthetic-long-password!2026';
let ctx: TestContext; let client: Client; let userId: string; let orgId: string;
beforeEach(async () => {
  ctx = await createTestContext(); resetAuthThrottles();
  setMailTransport(async () => ({ sent: true, transport: 'custom' }));
  ({ userId, orgId } = createWorkspace(ctx.db, { name: 'Synthetic Owner', email: 'owner@example.invalid', passwordHash: await hashPassword(PASSWORD), organizationName: 'Synthetic Org' }));
  client = await signIn(ctx.app, 'owner@example.invalid', PASSWORD);
});
afterEach(async () => { await ctx.cleanup(); setMailTransport(null); vi.restoreAllMocks(); });
const post = (path: string, body: object = {}) => client.agent.post(`/api/auth${path}`).set('x-csrf-token', client.csrf).send(body);
async function enroll() {
  const setup = await post('/mfa/setup', { password: PASSWORD }); expect(setup.status).toBe(200);
  const enabled = await post('/mfa/enable', { code: totp(setup.body.secret) }); expect(enabled.status).toBe(200);
  client.csrf = enabled.body.csrfToken;
  return { secret: setup.body.secret as string, codes: enabled.body.recoveryCodes as string[] };
}
function nextCode(secret: string) {
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 30_000);
  return { code: totp(secret), clock };
}

describe('authenticator two-factor authentication', () => {
  it('requires password reauthentication and denies cross-site setup and demo mutations', async () => {
    expect((await post('/mfa/setup', { password: 'wrong' })).status).toBe(401);
    expect((await client.agent.post('/api/auth/mfa/setup').send({ password: PASSWORD })).status).toBe(403);
    expect((await client.agent.post('/api/auth/mfa/setup').set('Origin', 'https://evil.invalid').set('x-csrf-token', client.csrf).send({ password: PASSWORD })).status).toBe(403);
    ctx.db.prepare('UPDATE organizations SET is_demo = 1 WHERE id = ?').run(orgId);
    expect((await post('/mfa/setup', { password: PASSWORD })).status).toBe(403);
  });
  it('does not activate before confirmation, encrypts the seed and returns recovery codes only once', async () => {
    const setup = await post('/mfa/setup', { password: PASSWORD });
    expect(setup.headers['cache-control']).toBe('no-store');
    expect((await client.agent.get('/api/auth/mfa')).body.enabled).toBe(false);
    expect(JSON.stringify(ctx.db.prepare('SELECT * FROM user_mfa').all())).not.toContain(setup.body.secret);
    expect((await post('/mfa/enable', { code: 'wrong' })).status).toBe(401);
    const enabled = await post('/mfa/enable', { code: totp(setup.body.secret) });
    expect(enabled.status).toBe(200); client.csrf = enabled.body.csrfToken;
    expect(enabled.body.recoveryCodes).toHaveLength(10);
    const stored = JSON.stringify(ctx.db.prepare('SELECT * FROM mfa_recovery_codes').all());
    for (const code of enabled.body.recoveryCodes) expect(stored).not.toContain(code.replaceAll('-', ''));
    const status = await client.agent.get('/api/auth/mfa');
    expect(status.body).toEqual({ available: true, enabled: true, recoveryCodesRemaining: 10 });
    expect(status.body.secret).toBeUndefined(); expect(status.body.recoveryCodes).toBeUndefined();
  });
  it('binds pending setup to its original session and expires it', async () => {
    const setup = await post('/mfa/setup', { password: PASSWORD });
    const other = await signIn(ctx.app, 'owner@example.invalid', PASSWORD);
    expect((await other.agent.post('/api/auth/mfa/enable').set('x-csrf-token', other.csrf).send({ code: totp(setup.body.secret) })).status).toBe(401);
    ctx.db.prepare('UPDATE user_mfa SET pending_expires_at = 1').run();
    expect((await post('/mfa/enable', { code: totp(setup.body.secret) })).status).toBe(401);
  });
  it('does not issue a session for password-only login; accepts one-use TOTP and rejects replay', async () => {
    const { secret } = await enroll();
    const partial = await request(ctx.app).post('/api/auth/sign-in').send({ email: 'owner@example.invalid', password: PASSWORD });
    expect(partial.status).toBe(202); expect(partial.body).toEqual({ mfaRequired: true });
    expect(partial.headers['set-cookie']).toBeUndefined();
    expect((await request(ctx.app).get('/api/dashboard')).status).toBe(401);
    const { code, clock } = nextCode(secret);
    try {
      const login = await request(ctx.app).post('/api/auth/sign-in').send({ email: 'owner@example.invalid', password: PASSWORD, mfaCode: code });
      expect(login.status).toBe(200); expect(login.body.csrfToken).toBeTruthy();
      expect((await request(ctx.app).post('/api/auth/sign-in').send({ email: 'owner@example.invalid', password: PASSWORD, mfaCode: code })).status).toBe(401);
    } finally { clock.mockRestore(); }
  });
  it('revokes sessions created before enabling MFA and centrally refuses unverified session creation', async () => {
    const old = await signIn(ctx.app, 'owner@example.invalid', PASSWORD);
    await enroll();
    expect((await old.agent.get('/api/auth/session')).status).toBe(401);
    expect(() => createSession(ctx.db, userId, orgId)).toThrow('two-factor');
    const id = crypto.randomBytes(24).toString('hex');
    ctx.db.prepare('INSERT INTO sessions(id,user_id,org_id,csrf_token,created_at,expires_at,mfa_verified) VALUES (?,?,?,?,?,?,0)')
      .run(id, userId, orgId, 'synthetic', new Date().toISOString(), new Date(Date.now()+60_000).toISOString());
    expect((await request(ctx.app).get('/api/auth/session').set('Cookie', `${config.sessionCookieName}=${encodeCookie(id)}`)).status).toBe(401);
  });
  it('consumes recovery codes atomically without disabling MFA', async () => {
    const { codes } = await enroll();
    const results = await Promise.all([0,1].map(() => request(ctx.app).post('/api/auth/sign-in').send({ email:'owner@example.invalid',password:PASSWORD,mfaCode:codes[0] })));
    expect(results.map(r=>r.status).sort()).toEqual([200,401]);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM mfa_recovery_codes').get()).toEqual({ n:9 });
    expect((await client.agent.get('/api/auth/mfa')).body.enabled).toBe(true);
  });
  it('persists a per-account failure cap across limiter resets and rotating IPs', async () => {
    await enroll();
    for (let i=0;i<5;i++) { resetAuthThrottles(); expect((await request(ctx.app).post('/api/auth/sign-in').set('X-Forwarded-For',`198.51.100.${i}`).send({email:'owner@example.invalid',password:PASSWORD,mfaCode:'invalid'})).status).toBe(401); }
    resetAuthThrottles();
    expect((await request(ctx.app).post('/api/auth/sign-in').send({email:'owner@example.invalid',password:PASSWORD,mfaCode:'invalid'})).status).toBe(429);
  });
  it('does not let password-reset links bypass MFA or remove the factor', async () => {
    await enroll(); const { token } = issuePasswordReset(ctx.db,userId);
    const reset = await request(ctx.app).post('/api/auth/reset-password').send({token,password:'Another-synthetic-password!2026'});
    expect(reset.status).toBe(200); expect(reset.body).toEqual({ok:true,signedIn:false});
    expect((await client.agent.get('/api/auth/session')).status).toBe(401);
    expect(ctx.db.prepare('SELECT enabled_at FROM user_mfa WHERE user_id=?').get(userId)).toBeTruthy();
  });
  it('requires MFA before an existing user can accept an invitation and gain membership', async () => {
    const { codes } = await enroll();
    const other = createWorkspace(ctx.db,{name:'Other Owner',email:'other@example.invalid',passwordHash:await hashPassword(PASSWORD),organizationName:'Other Org'});
    const token = 'synthetic-invite-token';
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    ctx.db.prepare('INSERT INTO invites(id,org_id,email,role,token_hash,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('inv_synthetic',other.orgId,'owner@example.invalid','MEMBER',hash,other.userId,new Date().toISOString(),new Date(Date.now()+60_000).toISOString());
    const data={email:'owner@example.invalid',password:PASSWORD};
    expect((await request(ctx.app).post(`/api/auth/invites/${token}/accept`).send(data)).status).toBe(202);
    expect(ctx.db.prepare('SELECT 1 FROM memberships WHERE org_id=? AND user_id=?').get(other.orgId,userId)).toBeUndefined();
    expect((await request(ctx.app).post(`/api/auth/invites/${token}/accept`).send({...data,mfaCode:codes[0]})).status).toBe(200);
  });
  it('requires current password and second factor to disable, and invalidates replaced recovery codes', async () => {
    const { codes } = await enroll();
    expect((await post('/mfa/disable',{password:'wrong',code:codes[0]})).status).toBe(401);
    const replaced=await post('/mfa/recovery-codes',{password:PASSWORD,code:codes[0]});
    expect(replaced.status).toBe(200); client.csrf=replaced.body.csrfToken;
    expect(verifyMfa(ctx.db,userId,codes[1]!)).toBe(false);
    const disabled=await post('/mfa/disable',{password:PASSWORD,code:replaced.body.recoveryCodes[0]});
    expect(disabled.status).toBe(200);
    expect(ctx.db.prepare('SELECT * FROM mfa_recovery_codes').all()).toHaveLength(0);
    expect((await request(ctx.app).post('/api/auth/sign-in').send({email:'owner@example.invalid',password:PASSWORD})).status).toBe(200);
  });
});

describe('published RFC 6238 SHA1 test vectors',()=>{
  it.each([[59, '94287082'], [1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']])('matches time %s',(time,expected)=>{
    expect(totp(base32(Buffer.from('12345678901234567890')), Math.floor(Number(time)/30),8)).toBe(expected);
  });
});
