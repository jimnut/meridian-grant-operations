/**
 * Server-side plan enforcement. The pure rules live in shared/plans.ts; this
 * module reads the organization row and the usage counters and raises the
 * typed errors the client renders as upgrade prompts.
 */

import type { Db } from '../db/connection';
import { computeWorkspaceStatus, FOUNDING_OFFER, type OrganizationPlanRow, type WorkspaceStatus } from '../../shared/plans';
import type { GrantStatus } from '../../shared/constants';
import type { WorkspaceUsage } from '../../shared/types';
import { planLimit } from './errors';

export interface OrganizationBillingRow extends OrganizationPlanRow {
  id: string;
  name: string;
  slug: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  billing_email: string | null;
  calendar_token: string | null;
  onboarding_dismissed_at: string | null;
}

export function loadOrganizationBilling(db: Db, orgId: string): OrganizationBillingRow | null {
  return (
    (db
      .prepare(
        `SELECT id, name, slug, plan, subscription_status, trial_ends_at, plan_valid_until, is_demo,
                stripe_customer_id, stripe_subscription_id, billing_email, calendar_token, onboarding_dismissed_at
           FROM organizations WHERE id = ?`,
      )
      .get(orgId) as OrganizationBillingRow | undefined) ?? null
  );
}

export function workspaceStatusFor(db: Db, orgId: string, now: Date = new Date()): WorkspaceStatus | null {
  const row = loadOrganizationBilling(db, orgId);
  return row ? computeWorkspaceStatus(row, now) : null;
}

/** Grants that count toward the plan's active-grant allowance. */
/** Organizations on a paid plan, online or invoiced; demo workspaces never count. */
export function countSubscribedOrganizations(db: Db): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS count FROM organizations WHERE is_demo = 0 AND plan IN ('starter', 'growth', 'scale')`)
      .get() as { count: number }
  ).count;
}

/** Places left on the founding-customer offer. */
export function foundingOfferRemaining(db: Db): number {
  return Math.max(0, FOUNDING_OFFER.organizations - countSubscribedOrganizations(db));
}

export function countsTowardLimit(status: GrantStatus): boolean {
  return status !== 'CLOSED' && status !== 'DECLINED';
}

export function countActiveGrants(db: Db, orgId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM grants
          WHERE org_id = ? AND archived = 0 AND status NOT IN ('CLOSED', 'DECLINED')`,
      )
      .get(orgId) as { count: number }
  ).count;
}

/** Editor seats in use. Viewers never count toward a plan's seat allowance. */
export function countMembers(db: Db, orgId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.org_id = ? AND u.is_active = 1 AND m.role <> 'VIEWER'`,
      )
      .get(orgId) as { count: number }
  ).count;
}

export function countPendingInvites(db: Db, orgId: string, now: Date = new Date()): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM invites
          WHERE org_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? AND role <> 'VIEWER'`,
      )
      .get(orgId, now.toISOString()) as { count: number }
  ).count;
}

export function storageBytesUsed(db: Db, orgId: string): number {
  return (
    db.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM documents WHERE org_id = ?').get(orgId) as {
      bytes: number;
    }
  ).bytes;
}

export function usageFor(db: Db, orgId: string): WorkspaceUsage {
  return {
    activeGrants: countActiveGrants(db, orgId),
    members: countMembers(db, orgId),
    pendingInvites: countPendingInvites(db, orgId),
    storageBytes: storageBytesUsed(db, orgId),
  };
}

function upgradeHint(status: WorkspaceStatus): string {
  return status.plan === 'trial'
    ? 'Choose a plan in Settings → Billing to raise the limit.'
    : 'Upgrade in Settings → Billing to raise the limit.';
}

/** Throws when adding one more counted grant would exceed the plan. */
export function assertGrantCapacity(db: Db, orgId: string, status: WorkspaceStatus): void {
  const limit = status.limits.activeGrants;
  if (limit === null) return;
  const current = countActiveGrants(db, orgId);
  if (current >= limit) {
    throw planLimit(
      `The ${status.planName} plan includes ${limit} active grants and this workspace already has ${current}. Close or archive a grant, or ${upgradeHint(status).replace(/^[A-Z]/, (c) => c.toLowerCase())}`,
    );
  }
}

/** Throws when one more editor seat (member or pending invite) would exceed the plan. Viewers are free. */
export function assertSeatCapacity(
  db: Db,
  orgId: string,
  status: WorkspaceStatus,
  includePending = true,
  role: string = 'MEMBER',
): void {
  const limit = status.limits.members;
  if (limit === null || role === 'VIEWER') return;
  const current = countMembers(db, orgId) + (includePending ? countPendingInvites(db, orgId) : 0);
  if (current >= limit) {
    throw planLimit(
      `The ${status.planName} plan includes ${limit} editor seats and this workspace has ${current} in use, counting pending invitations. Viewers are always free. ${upgradeHint(status)}`,
    );
  }
}

/** Throws when storing `additionalBytes` more evidence would exceed the plan. */
export function assertStorageCapacity(db: Db, orgId: string, status: WorkspaceStatus, additionalBytes: number): void {
  const limitBytes = status.limits.storageMb * 1024 * 1024;
  const used = storageBytesUsed(db, orgId);
  if (used + additionalBytes > limitBytes) {
    const usedMb = Math.round(used / 1024 / 1024);
    throw planLimit(
      `The ${status.planName} plan includes ${Math.round(status.limits.storageMb / 1024)} GB of evidence storage and this workspace has used ${usedMb} MB. Delete unused files, or ${upgradeHint(status).replace(/^[A-Z]/, (c) => c.toLowerCase())}`,
    );
  }
}
