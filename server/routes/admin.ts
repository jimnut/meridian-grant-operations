/**
 * Founder-only operations, authenticated with a bearer token from the
 * environment rather than a session: list workspaces and leads, and set a
 * plan by hand for invoiced or complimentary customers. Mounted outside the
 * CSRF gate because it is called from a terminal, never a browser.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';

import { config } from '../config';
import { logActivity } from '../lib/activity';
import { ApiError, notFound } from '../lib/errors';
import { handler, parseBody } from '../lib/http';
import { timingSafeEqual } from '../lib/ids';
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
    res.json(req.db.prepare('SELECT * FROM leads ORDER BY created_at DESC LIMIT 500').all());
  }),
);

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
