import { computeWorkspaceStatus, type OrganizationPlanRow } from '../../shared/plans';
import type { Db } from '../db/connection';

/** Aggregate account state only. Neither active status nor Stripe linkage proves payment. */
export interface CommercialSummary {
  asOf: string;
  totalNonDemoOrganizations: number;
  liveTrialOrganizations: number;
  expiredTrialOrganizations: number;
  trialOrganizationsWithoutEndDate: number;
  activeSubscriptionOrganizations: number;
  /** A subset of activeSubscriptionOrganizations, not a separate customer count. */
  activeStripeLinkedOrganizations: number;
  complimentaryOrganizations: number;
  expiredComplimentaryOrganizations: number;
  otherOrganizations: number;
}

/**
 * Startup diagnostics for authenticated hosting logs; no new public surface.
 * The query never loads tenant identifiers, names, contacts or Stripe IDs.
 * Trials without an end date are kept separate from current time-bounded trials.
 */
export function buildCommercialSummary(db: Db, now: Date = new Date()): CommercialSummary {
  const rows = db.prepare(`
    SELECT plan, subscription_status, trial_ends_at, plan_valid_until, is_demo,
           CASE WHEN NULLIF(TRIM(stripe_subscription_id), '') IS NOT NULL THEN 1 ELSE 0 END AS has_stripe_subscription
    FROM organizations
    WHERE is_demo = 0
  `).all() as Array<OrganizationPlanRow & { has_stripe_subscription: number }>;

  const summary: CommercialSummary = {
    asOf: now.toISOString(),
    totalNonDemoOrganizations: rows.length,
    liveTrialOrganizations: 0,
    expiredTrialOrganizations: 0,
    trialOrganizationsWithoutEndDate: 0,
    activeSubscriptionOrganizations: 0,
    activeStripeLinkedOrganizations: 0,
    complimentaryOrganizations: 0,
    expiredComplimentaryOrganizations: 0,
    otherOrganizations: 0,
  };

  for (const row of rows) {
    const workspace = computeWorkspaceStatus(row, now);
    if (row.subscription_status === 'trialing') {
      if (workspace.status === 'expired') summary.expiredTrialOrganizations += 1;
      else if (!row.trial_ends_at) summary.trialOrganizationsWithoutEndDate += 1;
      else summary.liveTrialOrganizations += 1;
    } else if (row.subscription_status === 'active') {
      summary.activeSubscriptionOrganizations += 1;
      if (row.has_stripe_subscription) summary.activeStripeLinkedOrganizations += 1;
    } else if (row.subscription_status === 'complimentary') {
      if (workspace.status === 'expired') summary.expiredComplimentaryOrganizations += 1;
      else summary.complimentaryOrganizations += 1;
    } else {
      // Past due, canceled and unrecognized stored statuses are not active subscriptions.
      summary.otherOrganizations += 1;
    }
  }

  return summary;
}
