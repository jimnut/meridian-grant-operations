import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { vi.stubEnv('RESEND_API_KEY', ''); });
import { createApp } from '../../server/app';
import { openDatabase } from '../../server/db/connection';
import { LEAD_FORM_TTL_MS, reserveLeadNotification } from '../../server/lib/lead-abuse';
import { leadFlag } from '../../server/lib/lead-quality';
import { setMailTransport, type MailMessage } from '../../server/lib/mailer';
import { resetPublicThrottles } from '../../server/routes/public';
import { createTestContext, type TestContext } from '../helpers/context';
import { loadLeadForm } from '../helpers/lead-form';

let ctx: TestContext;
const outbox: MailMessage[] = [];
const inquiry = (index = 0) => ({ email: `visitor${index}@example.org`, name: 'أحمد حسن', organization: 'River Nonprofit', message: `Can you help with grant reporting? Request ${index}.`, source: 'contact' });

beforeAll(async () => {
  ctx = await createTestContext();
  setMailTransport(async (message) => { outbox.push(message); return { sent: true, transport: 'custom' }; });
});
beforeEach(() => {
  resetPublicThrottles();
  ctx.db.exec('DELETE FROM leads; DELETE FROM lead_form_uses; DELETE FROM lead_mail_attempts');
  outbox.length = 0;
});
afterAll(async () => { await ctx.cleanup(); setMailTransport(null); vi.unstubAllEnvs(); });

async function submit(index: number, overrides = {}, ip?: string) {
  const { token, cookie } = await loadLeadForm(ctx.app);
  const pending = request(ctx.app).post('/api/public/leads').set('Cookie', cookie);
  if (ip) pending.set('X-Forwarded-For', ip);
  return pending.send({ ...inquiry(index), ...overrides, formToken: token });
}

describe('public form abuse protection', () => {
  it.each(['/contact', '/pricing'])('issues uncached browser-bound tokens on %s and accepts a legitimate no-JS form', async (page) => {
    const { token, cookie, response } = await loadLeadForm(ctx.app, page);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const header = (response.headers['set-cookie'] as unknown as string[]).find((v) => v.startsWith(cookie))!;
    expect(header).toContain('HttpOnly'); expect(header).toContain('Secure'); expect(header).toContain('SameSite=Strict');
    const posted = await request(ctx.app).post('/api/public/leads').set('Cookie', cookie).type('form')
      .send({ ...inquiry(), source: page.slice(1), formToken: token });
    expect(posted.status).toBe(303); expect(outbox).toHaveLength(2);
    expect(ctx.db.prepare('SELECT quality_status FROM leads').get()).toEqual({ quality_status: 'unreviewed' });
  });

  it('blocks direct POSTs, forged tokens, stolen tokens without the cookie, and cross-site requests', async () => {
    const { token, cookie } = await loadLeadForm(ctx.app);
    const other = await loadLeadForm(ctx.app);
    const cases = [
      { token: undefined, cookie },
      { token: `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`, cookie },
      { token, cookie: '' },
      { token, cookie: other.cookie },
    ];
    for (const item of cases) {
      const response = await request(ctx.app).post('/api/public/leads').set('Cookie', item.cookie).send({ ...inquiry(), formToken: item.token });
      expect(response.status).toBe(403);
    }
    const cross = await request(ctx.app).post('/api/public/leads').set('Cookie', cookie).set('Sec-Fetch-Site', 'cross-site').send({ ...inquiry(), formToken: token });
    expect(cross.status).toBe(403); expect(outbox).toHaveLength(0);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM leads').get()).toEqual({ n: 0 });
  });

  it('rejects expired forms with a recovery link and accepts a freshly loaded form', async () => {
    const { token, cookie } = await loadLeadForm(ctx.app);
    const issued = Number(token.split('.')[0]);
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(issued + LEAD_FORM_TTL_MS);
    try {
      const expired = await request(ctx.app).post('/api/public/leads').set('Cookie', cookie).type('form').send({ ...inquiry(), formToken: token });
      expect(expired.status).toBe(403); expect(expired.text).toContain('href="/contact"'); expect(outbox).toHaveLength(0);
      expect((await submit(1)).status).toBe(201);
    } finally { vi.useRealTimers(); }
  });

  it('keeps independently issued forms usable across tabs in the same browser', async () => {
    const first = await loadLeadForm(ctx.app);
    const second = await request(ctx.app).get('/pricing').set('Cookie', first.cookie);
    const secondToken = second.text.match(/name="formToken" value="([^"]+)"/)?.[1];
    expect(secondToken).toBeTruthy();
    expect(secondToken).not.toBe(first.token);
    for (const [index, token] of [first.token, secondToken].entries()) {
      const response = await request(ctx.app).post('/api/public/leads').set('Cookie', first.cookie)
        .send({ ...inquiry(index), formToken: token });
      expect(response.status).toBe(201);
    }
    expect(outbox).toHaveLength(4);
  });

  it('rejects a correctly signed token issued in the future', async () => {
    const now = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(now + 60_000);
      const { token, cookie } = await loadLeadForm(ctx.app);
      vi.setSystemTime(now);
      const response = await request(ctx.app).post('/api/public/leads').set('Cookie', cookie)
        .send({ ...inquiry(), formToken: token });
      expect(response.status).toBe(403);
      expect(outbox).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });

  it('consumes a token atomically across concurrent replays and fresh app instances', async () => {
    const { token, cookie } = await loadLeadForm(ctx.app);
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => request(ctx.app).post('/api/public/leads')
      .set('Cookie', cookie).send({ ...inquiry(i), formToken: token })));
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 202)).toHaveLength(7);
    resetPublicThrottles();
    const fresh = await ctx.serve(createApp({ db: ctx.db, uploadsDir: ctx.uploadsDir }));
    expect((await request(fresh).post('/api/public/leads').set('Cookie', cookie).send({ ...inquiry(99), formToken: token })).status).toBe(202);
    expect(outbox).toHaveLength(2);
  });

  it('quarantines synthetic scam links even with valid browser tokens, without blocking other languages', async () => {
    const scam = 'Получить перевод https://spam.example.invalid/claim';
    expect((await submit(1, { name: scam, organization: scam, message: scam })).status).toBe(202);
    expect(outbox).toHaveLength(0);
    expect(ctx.db.prepare('SELECT quality_status, quality_reason FROM leads').get()).toEqual({ quality_status: 'flagged', quality_reason: 'identity_contains_link' });
    expect((await submit(2, { name: 'Иван Петров', organization: 'Благотворительный фонд', message: 'Помогите с отчетностью по грантам.' })).status).toBe(201);
    expect(outbox).toHaveLength(2);
  });

  it.each([
    'Вы стали обладателем уникального бонуса! Проверьте детали https://reward.example.invalid/claim',
    'Вам перевод 12345 руб. Получить https://reward.example.invalid/transfer',
    'Claim your free prize at https://reward.example.invalid/claim',
  ])('quarantines a message-only reward solicitation before reserving or queueing mail: %s', async (message) => {
    expect((await submit(1, { name: 'Synthetic Visitor', organization: 'Synthetic Visitor', message })).status).toBe(202);
    expect(outbox).toHaveLength(0);
    expect(ctx.db.prepare('SELECT quality_status, quality_reason FROM leads').get())
      .toEqual({ quality_status: 'flagged', quality_reason: 'linked_reward_solicitation' });
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM lead_mail_outbox').get()).toEqual({ n: 0 });
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM lead_mail_attempts').get()).toEqual({ n: 0 });
  });

  it.each([
    'Our staff bonus policy is at https://nonprofit.example.invalid/policy. Can we track it against restricted grants?',
    'Мы получили грант. Нужна помощь с отчётностью: https://nonprofit.example.invalid/grants',
  ])('keeps legitimate linked inquiries eligible for notifications: %s', async (message) => {
    expect((await submit(1, { message })).status).toBe(201);
    expect(ctx.db.prepare('SELECT quality_status FROM leads').get()).toEqual({ quality_status: 'unreviewed' });
    expect(outbox).toHaveLength(2);
  });

  it('limits changed messages from the same address even with rotating connections', async () => {
    for (let i = 0; i < 4; i++) {
      const result = await submit(i, { email: i % 2 ? 'SAME@example.org' : 'same@example.org' }, `198.51.100.${i + 1}`);
      expect(result.status).toBe(i < 2 ? 201 : 202);
    }
    expect(outbox).toHaveLength(4);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM leads WHERE quality_reason = 'notification_sender_limit'").get()).toEqual({ n: 2 });
  });

  it('bounds concurrent rotating senders and IPs globally; excess inquiries remain reviewable', async () => {
    const responses = await Promise.all(Array.from({ length: 10 }, (_, i) => submit(i, {}, `198.51.100.${i + 1}`)));
    expect(responses.filter((r) => r.status === 201)).toHaveLength(5);
    expect(responses.filter((r) => r.status === 202)).toHaveLength(5);
    expect(outbox).toHaveLength(10);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM leads WHERE quality_reason = 'notification_global_limit'").get()).toEqual({ n: 5 });
  });

  it('caps five-minute submissions at three notification pairs despite limiter resets', async () => {
    const start = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (let i = 0; i < 5; i++) {
        vi.setSystemTime(start + i * 5 * 60 * 1000);
        resetPublicThrottles();
        expect((await submit(i)).status).toBe(i < 3 ? 201 : 202);
      }
      expect(outbox).toHaveLength(6);
    } finally { vi.useRealTimers(); }
  });

  it('keeps reservations when the provider fails, without retry storms or lost inquiries', async () => {
    setMailTransport(async () => ({ sent: false, transport: 'custom', error: 'Synthetic outage' }));
    try {
      expect((await submit(1)).status).toBe(201);
      expect((await submit(1)).status).toBe(202);
      expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM lead_mail_attempts').get()).toEqual({ n: 1 });
      expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM leads').get()).toEqual({ n: 1 });
    } finally { setMailTransport(async (message) => { outbox.push(message); return { sent: true, transport: 'custom' }; }); }
  });
});

describe('persistent rolling notification limits', () => {
  it('survives closing and reopening a database and enforces hourly and daily aggregate caps', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-abuse-'));
    const file = path.join(dir, 'test.sqlite');
    let db = openDatabase(file);
    const start = Date.now();
    const reserve = (i: number, now: number) => db.transaction(() => reserveLeadNotification(db,
      { id: `lead${i}`, email: `synthetic${i}@example.org`, ip: `198.51.100.${i}` }, now)).immediate();
    try {
      for (let i = 0; i < 5; i++) expect(reserve(i, start)).toBeNull();
      db.close(); db = openDatabase(file);
      expect(reserve(6, start + 5 * 60 * 1000)).toBe('notification_global_limit');
      for (let i = 5; i < 15; i++) expect(reserve(i, start + (Math.floor(i / 5) * 3600000))).toBeNull();
      expect(reserve(16, start + 3 * 3600000)).toBe('notification_global_limit');
      expect(reserve(17, start + 24 * 3600000)).toBeNull();
      const stored = JSON.stringify(db.prepare('SELECT * FROM lead_mail_attempts').all());
      expect(stored).not.toContain('@example.org'); expect(stored).not.toContain('198.51.100');
    } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it.each([
    [{ name: 'https://spam.example', organization: null, message: null }, 'identity_contains_link'],
    [{ name: 'Normal', organization: 'www.spam.example', message: null }, 'identity_contains_link'],
    [{ name: 'h\u200Bttps://spam.example', organization: null, message: null }, 'identity_contains_link'],
    [{ name: 'Normal\r\nBcc: test@example.org', organization: null, message: null }, 'identity_contains_newline'],
    [{ name: 'Self Employed', organization: 'Self Employed', message: 'Please send details.' }, null],
    [{ name: 'Jane', organization: 'River Foundation', message: 'Our site is https://nonprofit.example and we need reporting help.' }, null],
    [{ name: 'Visitor', organization: 'Visitor', message: 'Ура! Ваш эксклюзивный подарок ждёт вас: www.reward.example.invalid' }, 'linked_reward_solicitation'],
    [{ name: 'Visitor', organization: 'Visitor', message: 'You have won a cash prize. h\u200Bttps://reward.example.invalid' }, 'linked_reward_solicitation'],
    [{ name: 'Jane', organization: 'River Foundation', message: 'You have won a cash prize.' }, null],
    [{ name: 'أحمد', organization: 'مؤسسة الخير', message: 'هل تدعمون تقارير المنح؟ موقعنا https://nonprofit.example.invalid' }, null],
    [{ name: 'Jane', organization: 'River Foundation', message: 'Can you confirm you have received our staff bonus policy? https://example.invalid/policy' }, null],
    [{ name: 'Jane', organization: 'River Foundation', message: 'You have received an exclusive bonus: https://reward.example.invalid' }, 'linked_reward_solicitation'],
  ])('flags high-confidence abuse while preserving ordinary inquiries: %j', (input, expected) => {
    expect(leadFlag(input)).toBe(expected);
  });

  it.each([
    'Our Q3 interim grant report is ready: https://example.invalid/grants/q3 — Section 5 covers the fund transfer schedule.',
    'Could you confirm updated staff bonus amounts before payroll? Draft policy: https://example.invalid/hr/bonus-policy',
    'Добрый день! Промежуточный отчёт по гранту размещён здесь: https://example.invalid/otchety — график траншей в разделе 4.',
    'Просим подтвердить начисление премий сотрудникам до даты перевода зарплаты. Реестр: https://example.invalid/zarplata',
    'مرحبًا، تقرير المنحة جاهز للمراجعة https://example.invalid/grants/report — وجدول تحويل الدفعات في الصفحة ٦.',
    'نرجو اعتماد مستحقات مكافآت الموظفين قبل موعد تحويل الرواتب. التفاصيل: https://example.invalid/hr/bonuses',
  ])('preserves a synthetic multilingual legitimate transfer/bonus context: %s', (message) => {
    expect(leadFlag({ name: 'Synthetic Visitor', organization: 'Synthetic Foundation', message })).toBeNull();
  });
});
