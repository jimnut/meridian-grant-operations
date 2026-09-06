/**
 * Transactional email.
 *
 * Provider-agnostic on purpose: the app ships with a Resend HTTP transport
 * (no SDK, plain fetch) and a console transport used whenever no provider is
 * configured. Nothing in the product *requires* email — invite links can be
 * copied, and password resets fall back to an owner-assisted flow — but when a
 * provider is present, reminders and resets arrive by email.
 */

import { config } from '../config';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailResult {
  sent: boolean;
  transport: 'resend' | 'console' | 'custom';
  id?: string;
  error?: string;
}

export type MailTransport = (message: MailMessage) => Promise<MailResult>;

let override: MailTransport | null = null;

/** Tests swap the transport to capture outgoing mail. */
export function setMailTransport(transport: MailTransport | null): void {
  override = transport;
}

export function mailerConfigured(): boolean {
  return Boolean(override) || Boolean(config.resendApiKey);
}

/** Minimal HTML escaping for the bodies we compose. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** A plain, readable HTML wrapper around paragraphs of text; no tracking pixels. */
export function renderHtml(title: string, paragraphs: string[], cta?: { label: string; url: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;font:16px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1814">${escapeHtml(p)}</p>`).join('');
  const button = cta
    ? `<p style="margin:22px 0"><a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:12px 18px;background:#ff4f00;color:#fff;text-decoration:none;border-radius:10px;font:700 15px -apple-system,Segoe UI,Helvetica,Arial,sans-serif">${escapeHtml(cta.label)}</a></p><p style="font:13px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#6d655a">If the button does not work, copy this link: ${escapeHtml(cta.url)}</p>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:28px;background:#faf6ef"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5ddd0;border-radius:14px;padding:28px"><p style="margin:0 0 18px;font:700 13px -apple-system,Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#c73e00">GrantConsole</p><h1 style="margin:0 0 16px;font:600 22px/1.3 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1814">${escapeHtml(title)}</h1>${body}${button}<p style="margin:24px 0 0;font:13px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#6d655a">GrantConsole · post-award grant management for nonprofits · <a href="${escapeHtml(config.siteUrl)}" style="color:#c73e00">${escapeHtml(config.siteUrl.replace(/^https?:\/\//, ''))}</a></p></div></body></html>`;
}

async function resendTransport(message: MailMessage): Promise<MailResult> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.emailFrom,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(config.emailReplyTo ? { reply_to: config.emailReplyTo } : {}),
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { sent: false, transport: 'resend', error: `Resend responded ${response.status}: ${detail.slice(0, 300)}` };
  }
  const data = (await response.json().catch(() => ({}))) as { id?: string };
  return { sent: true, transport: 'resend', id: data.id };
}

async function consoleTransport(message: MailMessage): Promise<MailResult> {
  if (!config.isTest) {
    console.info(`[mail] no provider configured — would send to ${message.to}: ${message.subject}`);
  }
  return { sent: false, transport: 'console' };
}

/** Never throws: a failed email must not fail the request that triggered it. */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  try {
    if (override) return await override(message);
    if (config.resendApiKey) return await resendTransport(message);
    return await consoleTransport(message);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[mail] failed to send to ${message.to}: ${reason}`);
    return { sent: false, transport: override ? 'custom' : config.resendApiKey ? 'resend' : 'console', error: reason };
  }
}
