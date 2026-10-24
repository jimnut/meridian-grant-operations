/**
 * Founder-only operations, authenticated with a bearer token from the
 * environment rather than a session: list workspaces and leads, and set a
 * plan by hand for invoiced or complimentary customers. Mounted outside the
 * CSRF gate because it is called from a terminal, never a browser.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { config } from '../config';
import { logActivity } from '../lib/activity';
import { conversionSummary } from '../lib/conversion-events';
import { ApiError, notFound } from '../lib/errors';
import { handler, parseBody } from '../lib/http';
import { timingSafeEqual } from '../lib/ids';
import { LEAD_QUALITY_STATUSES } from '../lib/lead-quality';
import { usageFor } from '../lib/plans';
import { adminPlanSchema } from '../lib/validation';
import { computeWorkspaceStatus, PLANS } from '../../shared/plans';

const router = Router();

function requireAdminToken(req: Request, _res: Response, next: NextFunction): void {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!config.adminToken || config.adminToken.length < 24 || !token || !timingSafeEqual(token, config.adminToken)) {
    next(new ApiError('UNAUTHENTICATED', 'Admin token required.'));
    return;
  }
  next();
}

router.use(requireAdminToken);

router.get('/conversions', handler((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(conversionSummary(req.db));
}));

router.patch('/conversions/quality', handler((req, res) => {
  const input = parseBody(z.object({
    organizationId: z.string().min(1).max(200),
    quality: z.enum(['unreviewed', 'qualified', 'spam', 'internal_test']),
  }), req.body);
  const result = req.db.prepare('UPDATE organizations SET conversion_quality = ? WHERE id = ? AND is_demo = 0')
    .run(input.quality, input.organizationId);
  if (!result.changes) throw notFound('Organization');
  res.json({ ok: true, quality: input.quality });
}));

router.get(
  '/organizations',
  handler((req, res) => {
    const rows = req.db
      .prepare(
        `SELECT o.id, o.name, o.slug, o.plan, o.subscription_status, o.trial_ends_at, o.plan_valid_until, o.is_demo,
                o.billing_email, o.stripe_customer_id, o.created_at,
                (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
                  WHERE m.org_id = o.id AND m.role = 'OWNER' ORDER BY m.created_at LIMIT 1) AS owner_email
           FROM organizations o ORDER BY o.created_at DESC`,
      )
      .all() as Array<Record<string, unknown> & { id: string; plan: string; subscription_status: string; trial_ends_at: string | null; plan_valid_until: string | null; is_demo: number }>;
    res.json(
      rows.map((row) => ({
        ...row,
        status: computeWorkspaceStatus(row),
        usage: usageFor(req.db, row.id),
      })),
    );
  }),
);

router.get(
  '/leads',
  handler((req, res) => {
    res.json(req.db.prepare(`SELECT id, email, name, organization, message, source, created_at,
      quality_status, quality_reason FROM leads ORDER BY created_at DESC LIMIT 500`).all());
  }),
);

router.patch('/leads/quality', handler((req, res) => {
  const input = parseBody(z.object({ id: z.string().min(1).max(100), quality: z.enum(LEAD_QUALITY_STATUSES) }), req.body);
  const result = req.db.prepare('UPDATE leads SET quality_status = ?, quality_reason = ? WHERE id = ?')
    .run(input.quality, 'owner_review', input.id);
  if (!result.changes) throw notFound('Lead');
  res.json({ ok: true });
}));

router.get('/leads/summary', handler((req, res) => {
  res.json({ counts: req.db.prepare(`SELECT quality_status AS quality, COUNT(*) AS submissions
    FROM leads GROUP BY quality_status`).all(),
    definition: 'Stored contact submissions, not trial activations. Historical rows are unreviewed. Duplicate and honeypot submissions are not stored. Flagged submissions receive no automated emails.' });
}));

/** Operational receipts: provider acceptance is deliberately separate from inbox delivery. */
router.get('/lead-mail', handler((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    counts: req.db.prepare('SELECT status, COUNT(*) AS count FROM lead_mail_outbox GROUP BY status').all(),
    provider: req.db.prepare('SELECT blocked_until, reason FROM lead_mail_provider_state WHERE id = 1').get() ?? null,
    jobs: req.db.prepare(`SELECT id, lead_id, kind, recipient, status, attempts, next_attempt_at,
      provider_id, last_error, created_at, sent_at FROM lead_mail_outbox ORDER BY created_at DESC LIMIT 100`).all(),
    definition: 'sent means provider accepted the request, not inbox delivery or a substantive human response. Historical leads are not automatically queued.',
  });
}));

router.get('/leads/reply-holds', handler((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(req.db.prepare('SELECT email, reason, created_at FROM lead_reply_holds ORDER BY created_at').all());
}));

router.post('/leads/reply-holds', handler((req, res) => {
  const input = parseBody(z.object({ email: z.string().trim().toLowerCase().email().max(200), reason: z.string().trim().min(1).max(200) }), req.body);
  req.db.transaction(() => {
    req.db.prepare(`INSERT INTO lead_reply_holds (email, reason, created_at) VALUES (?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET reason = excluded.reason`).run(input.email, input.reason, Date.now());
    req.db.prepare(`UPDATE lead_mail_outbox SET status = 'held', last_error = 'recipient_hold'
      WHERE recipient = ? AND status = 'pending'`).run(input.email);
  }).immediate();
  res.json({ ok: true });
}));

router.delete('/leads/reply-holds', handler((req, res) => {
  const input = parseBody(z.object({ email: z.string().trim().toLowerCase().email().max(200) }), req.body);
  if (config.leadReplyHoldEmails.includes(input.email)) {
    throw new ApiError('BAD_REQUEST', 'Remove this address from LEAD_REPLY_HOLD_EMAILS before explicitly releasing its persisted hold.');
  }
  req.db.transaction(() => {
    req.db.prepare('DELETE FROM lead_reply_holds WHERE email = ?').run(input.email);
    req.db.prepare(`UPDATE lead_mail_outbox SET status = 'pending', next_attempt_at = ?, last_error = NULL
      WHERE recipient = ? AND status = 'held'`).run(Date.now(), input.email);
  }).immediate();
  res.json({ ok: true });
}));

router.post(
  '/plan',
  handler((req, res) => {
    const input = parseBody(adminPlanSchema, req.body);
    const org = req.db.prepare('SELECT id, name FROM organizations WHERE slug = ?').get(input.organizationSlug) as
      | { id: string; name: string }
      | undefined;
    if (!org) throw notFound('Organization');
    const now = new Date().toISOString();
    req.db
      .prepare(
        `UPDATE organizations SET plan = ?, subscription_status = ?, plan_valid_until = ?, trial_ends_at = COALESCE(?, trial_ends_at), updated_at = ?
          WHERE id = ?`,
      )
      .run(input.plan, input.status, input.validUntil ? `${input.validUntil}T23:59:59.000Z` : null, input.trialEndsAt ? `${input.trialEndsAt}T23:59:59.000Z` : null, now, org.id);
    const planName = input.plan === 'trial' ? 'Trial' : PLANS[input.plan].name;
    logActivity(req.db, {
      orgId: org.id,
      actorUserId: null,
      entityType: 'ORGANIZATION',
      entityId: org.id,
      action: 'PLAN_SET',
      summary: `Plan set to ${planName} (${input.status})${input.validUntil ? ` until ${input.validUntil}` : ''} by GrantConsole support`,
    });
    const row = req.db
      .prepare('SELECT plan, subscription_status, trial_ends_at, plan_valid_until, is_demo FROM organizations WHERE id = ?')
      .get(org.id) as { plan: string; subscription_status: string; trial_ends_at: string | null; plan_valid_until: string | null; is_demo: number };
    res.json({ organization: org, status: computeWorkspaceStatus(row) });
  }),
);

export default router;
