/**
 * Unauthenticated endpoints used by the marketing site: lead capture from the
 * contact and pricing pages. Accepts JSON and plain HTML form posts, so the
 * dependency-free public pages work with no JavaScript at all.
 */

import { Router } from 'express';

import { config } from '../config';
import { handler, parseBody } from '../lib/http';
import { newId } from '../lib/ids';
import { renderHtml, sendMail } from '../lib/mailer';
import { createThrottle } from '../lib/throttle';
import { leadSchema } from '../lib/validation';

const router = Router();

const leadThrottle = createThrottle({
  windowMs: 60 * 60 * 1000,
  max: 12,
  message: 'Too many messages from this connection. Try again in an hour.',
});

export function resetPublicThrottles(): void {
  leadThrottle.reset();
}

function wantsHtml(accept: string | undefined, contentType: string | undefined): boolean {
  if (contentType?.includes('application/x-www-form-urlencoded')) return true;
  return Boolean(accept && accept.includes('text/html') && !accept.includes('application/json'));
}

router.post(
  '/leads',
  handler(async (req, res) => {
    const html = wantsHtml(req.get('accept'), req.get('content-type'));
    const input = parseBody(leadSchema, req.body);
    if (input.website) {
      // Honeypot filled in: pretend it worked, store nothing.
      if (html) res.redirect(303, '/contact/thanks');
      else res.status(202).json({ ok: true });
      return;
    }
    leadThrottle.hit(req.ip ?? 'local');

    const id = newId('lead');
    const now = new Date().toISOString();
    req.db
      .prepare(
        `INSERT INTO leads (id, email, name, organization, message, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.email, input.name, input.organization, input.message, input.source, now);

    // Logged as well as stored so a lead survives even on ephemeral storage.
    console.info(
      `[lead] ${input.source} ${input.email}${input.name ? ` (${input.name})` : ''}${input.organization ? ` — ${input.organization}` : ''}${input.message ? `: ${input.message.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`,
    );

    void sendMail({
      to: config.leadNotificationEmail,
      subject: `New ${input.source} lead: ${input.organization ?? input.email}`,
      text: [`Email: ${input.email}`, `Name: ${input.name ?? '—'}`, `Organization: ${input.organization ?? '—'}`, `Source: ${input.source}`, '', input.message ?? '(no message)'].join('\n'),
    });
    void sendMail({
      to: input.email,
      subject: 'We received your message — GrantConsole',
      text: `Thanks for reaching out${input.name ? `, ${input.name}` : ''}. A real person will reply within one business day.\n\nIn the meantime you can open the live demo at ${config.siteUrl}/signin or start a free trial at ${config.siteUrl}/signup.`,
      html: renderHtml(
        'We received your message',
        [
          `Thanks for reaching out${input.name ? `, ${input.name}` : ''}. A real person will reply within one business day.`,
          'In the meantime you can open the live demo or start a free trial — no card needed.',
        ],
        { label: 'Start a free trial', url: `${config.siteUrl}/signup` },
      ),
    });

    if (html) {
      res.redirect(303, '/contact/thanks');
      return;
    }
    res.status(201).json({ ok: true, id });
  }),
);

export default router;
