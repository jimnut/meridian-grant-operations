import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildCommercialSummary } from '../../server/services/commercial-summary';

const NOW = new Date('2026-09-09T12:00:00.000Z');
const PAST = '2026-09-08T12:00:00.000Z';
const FUTURE = '2026-09-10T12:00:00.000Z';
let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  // Minimal isolated rows: no real accounts or production database access.
  db.exec(`CREATE TABLE organizations (
    plan TEXT, subscription_status TEXT, trial_ends_at TEXT, plan_valid_until TEXT,
    is_demo INTEGER, stripe_subscription_id TEXT,
    id TEXT DEFAULT 'private-test-id', name TEXT DEFAULT 'Private Test Name',
    billing_email TEXT DEFAULT 'private-test@example.org'
  )`);
});
afterEach(() => db.close());

function add(status: string, options: { demo?: boolean; trialEnd?: string; validUntil?: string; stripeSubscription?: string } = {}): void {
  db.prepare('INSERT INTO organizations (plan, subscription_status, trial_ends_at, plan_valid_until, is_demo, stripe_subscription_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run('growth', status, options.trialEnd ?? null, options.validUntil ?? null, options.demo ? 1 : 0, options.stripeSubscription ?? null);
}

describe('commercial startup summary', () => {
  it('counts only non-demo organizations and keeps account state separate from Stripe linkage', () => {
    add('active', { demo: true, stripeSubscription: 'sub_demo_private' });
    add('trialing', { demo: true, trialEnd: FUTURE });
    add('trialing', { trialEnd: FUTURE });
    add('trialing', { trialEnd: PAST });
    add('trialing');
    add('active');
    add('active', { stripeSubscription: 'sub_real_private' });
    add('active', { stripeSubscription: '   ' });
    add('complimentary');
    add('complimentary', { validUntil: FUTURE });
    add('complimentary', { validUntil: PAST });
    add('past_due', { stripeSubscription: 'sub_past_due_private' });
    add('canceled', { validUntil: FUTURE, stripeSubscription: 'sub_canceled_private' });

    const summary = buildCommercialSummary(db, NOW);
    expect(summary).toEqual({
      asOf: NOW.toISOString(),
      totalNonDemoOrganizations: 11,
      liveTrialOrganizations: 1,
      expiredTrialOrganizations: 1,
      trialOrganizationsWithoutEndDate: 1,
      activeSubscriptionOrganizations: 3,
      activeStripeLinkedOrganizations: 1,
      complimentaryOrganizations: 2,
      expiredComplimentaryOrganizations: 1,
      otherOrganizations: 2,
    });
    const serialized = JSON.stringify(summary);
    for (const privateValue of ['private-test-id', 'Private Test Name', 'private-test@example.org', 'sub_real_private', 'sub_demo_private']) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('expires trials and complimentary periods at the same instant as workspace access', () => {
    add('trialing', { trialEnd: NOW.toISOString() });
    add('complimentary', { validUntil: NOW.toISOString() });
    const summary = buildCommercialSummary(db, NOW);
    expect(summary.liveTrialOrganizations).toBe(0);
    expect(summary.expiredTrialOrganizations).toBe(1);
    expect(summary.complimentaryOrganizations).toBe(0);
    expect(summary.expiredComplimentaryOrganizations).toBe(1);
  });

  it('reports an empty database as zero organizations rather than inferring customers', () => {
    const summary = buildCommercialSummary(db, NOW);
    for (const [key, value] of Object.entries(summary)) {
      if (key !== 'asOf') expect(value).toBe(0);
    }
  });
});
