import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { vi.stubEnv('RESEND_API_KEY', ''); vi.stubEnv('LEAD_REPLY_HOLD_EMAILS', 'configured@example.org'); });

import { config } from '../../server/config';
import { dispatchLeadMail, enqueueLeadMail } from '../../server/lib/lead-mail';
import { setMailTransport, type MailMessage } from '../../server/lib/mailer';
import { createTestContext, type TestContext } from '../helpers/context';

let context: TestContext;
let messages: MailMessage[];
const auth = () => `Bearer ${config.adminToken}`;
function enqueue(email = 'visitor@example.org') {
  const lead = { id: 'operator-test', email, source: 'contact', message: 'Private synthetic enquiry content' };
  context.db.transaction(() => {
    context.db.prepare('INSERT INTO leads (id, email, source, message, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(lead.id, email, lead.source, lead.message, new Date().toISOString());
    enqueueLeadMail(context.db, lead);
  }).immediate();
}
beforeEach(async () => {
  context = await createTestContext(); messages = [];
  setMailTransport(async (message) => { messages.push(message); return { sent: true, transport: 'custom', id: 'synthetic-receipt' }; });
});
afterEach(async () => { setMailTransport(null); await context.cleanup(); });

describe('owner lead-mail operations', () => {
  it('requires owner authentication and excludes enquiry bodies from operational receipts', async () => {
    enqueue();
    expect((await request(context.app).get('/api/admin/lead-mail')).status).toBe(401);
    expect((await request(context.app).post('/api/admin/leads/reply-holds').send({ email: 'visitor@example.org', reason: 'hold' })).status).toBe(401);
    const response = await request(context.app).get('/api/admin/lead-mail').set('Authorization', auth());
    expect(response.status).toBe(200); expect(response.body.jobs).toHaveLength(2);
    expect(JSON.stringify(response.body)).not.toContain('Private synthetic enquiry content');
    expect(JSON.stringify(response.body)).not.toContain(config.adminToken);
  });

  it('persists a normalized hold and resumes only after an explicit owner release', async () => {
    enqueue();
    const held = await request(context.app).post('/api/admin/leads/reply-holds').set('Authorization', auth())
      .send({ email: ' VISITOR@EXAMPLE.ORG ', reason: 'Explicit synthetic hold' });
    expect(held.status).toBe(200);
    await dispatchLeadMail(context.db);
    expect(messages.some((message) => message.to === 'visitor@example.org')).toBe(false);
    expect((await request(context.app).delete('/api/admin/leads/reply-holds').send({ email: 'visitor@example.org' })).status).toBe(401);
    const released = await request(context.app).delete('/api/admin/leads/reply-holds').set('Authorization', auth()).send({ email: 'visitor@example.org' });
    expect(released.status).toBe(200);
    await dispatchLeadMail(context.db); await dispatchLeadMail(context.db);
    expect(messages.filter((message) => message.to === 'visitor@example.org')).toHaveLength(1);
  });

  it('seeds the configured hold before sending and refuses release while it is configured', async () => {
    enqueue('configured@example.org');
    await dispatchLeadMail(context.db);
    expect(messages.some((message) => message.to === 'configured@example.org')).toBe(false);
    expect((await request(context.app).delete('/api/admin/leads/reply-holds').set('Authorization', auth())
      .send({ email: 'configured@example.org' })).status).toBe(400);
    const response = await request(context.app).get('/api/admin/leads/reply-holds').set('Authorization', auth());
    expect(response.body).toContainEqual(expect.objectContaining({ email: 'configured@example.org' }));
  });
});
