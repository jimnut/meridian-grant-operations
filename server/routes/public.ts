/**
 * Unauthenticated endpoints used by the marketing site: lead capture from the
 * contact and pricing pages. Accepts JSON and plain HTML form posts, so the
 * dependency-free public pages work with no JavaScript at all.
 */

import { Router } from 'express';

import { config } from '../config';
import { consumeLeadToken, reserveLeadNotification, verifiedLeadToken } from '../lib/lead-abuse';
import { handler, parseBody } from '../lib/http';
import { newId } from '../lib/ids';
import { clearLeadReceipt, issueLeadReceipt, leadFingerprint, leadFlag, LEAD_DUPLICATE_MS } from '../lib/lead-quality';
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
    clearLeadReceipt(res);
    if (input.website) {
      // Honeypot filled in: pretend it worked, store nothing.
      if (html) res.redirect(303, '/contact/thanks');
      else res.status(202).json({ ok: true });
      return;
    }
    leadThrottle.hit(req.ip ?? 'local');

    const now = new Date();
    const tokenHash = verifiedLeadToken(req, input.formToken, now.getTime());
    if (!tokenHash) {
      res.setHeader('Cache-Control', 'no-store');
      if (html) res.status(403).type('html').send('<!doctype html><html lang="en"><meta charset="utf-8"><title>Please reload the form</title><h1>Please reload the form</h1><p>This form expired or could not be verified. Copy your message, then open a fresh <a href="/contact">contact form</a> or <a href="/pricing">pricing form</a> and try again. Cookies must be enabled.</p></html>');
      else res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Reload the contact or pricing form and try again.' } });
      return;
    }
    const fingerprint = leadFingerprint(input);
    let reason = leadFlag(input);
    const id = req.db.transaction(() => {
      if (!consumeLeadToken(req.db, tokenHash, now.getTime())) return null;
      const duplicate = req.db.prepare('SELECT id FROM leads WHERE fingerprint = ? AND created_at > ? LIMIT 1')
        .get(fingerprint, new Date(now.getTime() - LEAD_DUPLICATE_MS).toISOString());
      if (duplicate) return null;
      const leadId = newId('lead');
      if (!reason) reason = reserveLeadNotification(req.db, { id: leadId, email: input.email, ip: req.ip ?? 'local' }, now.getTime());
      req.db.prepare(`INSERT INTO leads
        (id, email, name, organization, message, source, created_at, fingerprint, quality_status, quality_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(leadId, input.email, input.name, input.organization, input.message, input.source,
          now.toISOString(), fingerprint, reason ? 'flagged' : 'unreviewed', reason);
      return leadId;
    }).immediate();
    if (!id || reason) {
      // Keep the same neutral response; flagged records remain reviewable by the
      // owner, without sending an acknowledgement to a potentially spoofed address.
      if (html) res.redirect(303, '/contact/thanks');
      else res.status(202).json({ ok: true });
      return;
    }
    // Operational logs deliberately exclude email, names and message content.
    console.info('[lead] accepted', { id, source: input.source });

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
      issueLeadReceipt(req.db, id, res, now);
      res.redirect(303, '/contact/thanks');
      return;
    }
    res.status(201).json({ ok: true, id });
  }),
);

export default router;
