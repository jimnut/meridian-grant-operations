import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { vi.stubEnv('RESEND_API_KEY', 're_synthetic_test_key'); });

import { sendMail, setMailTransport } from '../../server/lib/mailer';

const message = {
  to: 'visitor@example.org', from: 'GrantConsole <team@example.org>', replyTo: 'reply@example.org',
  subject: 'Synthetic acknowledgement', text: 'Synthetic test body', idempotencyKey: 'lead-mail/synthetic/acknowledgement',
};
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  setMailTransport(null);
  fetchMock = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { setMailTransport(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Resend delivery metadata', () => {
  it('sends the durable envelope and provider idempotency key with a bounded request', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'synthetic-receipt' }), { status: 200 }));
    expect(await sendMail(message)).toEqual({ sent: true, transport: 'resend', id: 'synthetic-receipt' });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(options?.headers).toMatchObject({ 'Idempotency-Key': message.idempotencyKey });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(options?.body))).toEqual({
      from: message.from, to: [message.to], reply_to: message.replyTo, subject: message.subject, text: message.text,
    });
  });

  it.each([
    ['120', 120_000],
    ['Sun, 25 Oct 2026 09:02:00 GMT', 120_000],
    ['invalid-value', undefined],
  ])('preserves quota code and Retry-After %j without logging provider body details', async (header, expected) => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-25T09:00:00Z'));
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: 'daily_quota_exceeded', message: 'Do not persist this private provider detail' }), {
      status: 429, headers: { 'Retry-After': header },
    }));
    const result = await sendMail(message);
    expect(result).toMatchObject({ sent: false, statusCode: 429, errorCode: 'daily_quota_exceeded', retryable: true, ambiguous: false });
    expect(result.retryAfterMs).toBe(expected);
    expect(result.error).not.toContain('private provider detail');
  });

  it.each([
    [422, 'validation_error', false, false],
    [401, 'validation_error', true, false],
    [500, 'internal_server_error', true, true],
    [409, 'concurrent_idempotent_requests', true, true],
  ])('classifies %s %s for safe retry', async (status, name, retryable, ambiguous) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ name }), { status }));
    expect(await sendMail(message)).toMatchObject({ sent: false, statusCode: status, errorCode: name, retryable, ambiguous });
  });

  it('keeps a successful HTTP response without a provider receipt ambiguous', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await sendMail(message)).toMatchObject({ sent: false, errorCode: 'missing_provider_receipt', retryable: true, ambiguous: true });
  });

  it('turns network failures into ambiguous retryable results without leaking error details in logs', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockRejectedValue(new Error('private-content synthetic credential'));
    expect(await sendMail(message)).toMatchObject({ sent: false, errorCode: 'transport_error', retryable: true, ambiguous: true });
    expect(JSON.stringify(errors.mock.calls)).not.toContain('private-content');
  });
});
