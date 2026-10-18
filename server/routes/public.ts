/**
 * Unauthenticated endpoints used by the marketing site: lead capture from the
 * contact and pricing pages. Accepts JSON and plain HTML form posts, so the
 * dependency-free public pages work with no JavaScript at all.
 */

import { Router } from 'express';

import { config } from '../config';
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
    const fingerprint = leadFingerprint(input);
    const reason = leadFlag(input);
    const id = req.db.transaction(() => {
      const duplicate = req.db.prepare('SELECT id FROM leads WHERE fingerprint = ? AND created_at > ? LIMIT 1')
        .get(fingerprint, new Date(now.getTime() - LEAD_DUPLICATE_MS).toISOString());
      if (duplicate) return null;
      const leadId = newId('lead');
      req.db.prepare(`INSERT INTO leads
        (id, email, name, organization, message, source, created_at, fingerprint, quality_status, quality_reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(leadId, input.email, input.name, input.organization, input.message, input.source,
          now.toISOString(), fingerprint, reason ? 'flagged' : 'unreviewed', reason);
      return leadId;
    })();
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
