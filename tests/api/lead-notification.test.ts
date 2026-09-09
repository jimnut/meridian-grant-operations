import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubEnv('LEAD_NOTIFICATION_EMAIL', ' Team-Inbox@Example.org ');
  vi.stubEnv('RESEND_API_KEY', '');
});

import { config, resolveLeadNotificationEmail } from '../../server/config';
import { setMailTransport, type MailMessage } from '../../server/lib/mailer';
import { createTestContext, type TestContext } from '../helpers/context';

let context: TestContext;
const outbox: MailMessage[] = [];

beforeAll(async () => {
  setMailTransport(async (message) => {
    outbox.push(message);
    return { sent: true, transport: 'custom' };
  });
  context = await createTestContext();
});

afterAll(async () => {
  try {
    await context.cleanup();
  } finally {
    setMailTransport(null);
    vi.unstubAllEnvs();
  }
});

describe('internal lead notifications', () => {
  it('routes the captured alert to the configured inbox and the acknowledgment to the visitor', async () => {
    const response = await request(context.app)
      .post('/api/public/leads')
      .send({ email: 'visitor@example.org', organization: 'Example Nonprofit', message: 'Please explain grant tracking.', source: 'contact' });

    expect(response.status).toBe(201);
    expect(config.leadNotificationEmail).toBe('team-inbox@example.org');
    expect(config.supportEmail).toBe('support@grantconsole.com');
    expect(outbox).toHaveLength(2);
    expect(outbox.find((message) => message.subject.startsWith('New contact lead:'))).toMatchObject({
      to: 'team-inbox@example.org',
      text: expect.stringContaining('Email: visitor@example.org'),
    });
    expect(outbox.find((message) => message.subject === 'We received your message — GrantConsole')).toMatchObject({
      to: 'visitor@example.org',
    });
  });

  it('preserves the public support fallback when the setting is absent or blank', () => {
    for (const env of [{}, { LEAD_NOTIFICATION_EMAIL: '' }, { LEAD_NOTIFICATION_EMAIL: '   ' }]) {
      expect(resolveLeadNotificationEmail(env)).toBe('support@grantconsole.com');
    }
  });

  it.each([
    'not-an-address',
    'first@example.org,second@example.org',
    'Team Inbox <team@example.org>',
    'team@example.org\r\nBcc: other@example.org',
    `${'a'.repeat(190)}@example.org`,
  ])('rejects an invalid recipient configuration: %j', (value) => {
    expect(() => resolveLeadNotificationEmail({ LEAD_NOTIFICATION_EMAIL: value })).toThrow('LEAD_NOTIFICATION_EMAIL must be one valid email address');
  });
});
