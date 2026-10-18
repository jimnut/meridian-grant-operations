import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type Db } from '../../server/db/connection';
import { loadSampleData } from '../../server/db/sample-data';
import { createWorkspace } from '../../server/lib/accounts';
import { conversionSummary, recordTrialActivation, recordTrialStarted } from '../../server/lib/conversion-events';
import { applyStripeEvent } from '../../server/routes/billing';

let db: Db;
const START = new Date('2026-09-01T00:00:00Z');
beforeEach(() => { db = openDatabase(':memory:'); });
afterEach(() => db.close());
function workspace(email = 'synthetic@example.org') {
  return createWorkspace(db, { name: 'Synthetic Person', email, passwordHash: 'unused-test-hash', organizationName: 'Synthetic Org', now: START });
}
function workflow(orgId: string, userId: string) {
  db.prepare(`INSERT INTO funders (id,org_id,name,type,created_at,updated_at) VALUES ('f',?,'Synthetic','OTHER',?,?)`).run(orgId, START.toISOString(), START.toISOString());
  db.prepare(`INSERT INTO grants (id,org_id,funder_id,owner_user_id,title,status,awarded_cents,created_at,updated_at)
    VALUES ('g',?,'f',?,'Synthetic award','AWARDED',10000,?,?)`).run(orgId, userId, START.toISOString(), START.toISOString());
  db.prepare(`INSERT INTO milestones (id,org_id,grant_id,type,title,due_date,created_at,updated_at)
    VALUES ('m',?,'g','REPORT','Synthetic report','2026-10-01',?,?)`).run(orgId, START.toISOString(), START.toISOString());
}
function event(type: string, object: Record<string, unknown>, id = `${type.replaceAll('.', '_')}_${Math.random()}`, created = 1788307200) {
  return { id, type, created, livemode: true, data: { object } };
}
const invoice = (overrides: Record<string, unknown> = {}) => ({ id: 'in_synthetic', customer: 'cus_synthetic', charge: 'ch_synthetic', subscription: 'sub_synthetic', amount_paid: 7900, paid: true, paid_out_of_band: false, status: 'paid', currency: 'usd', ...overrides });
function link(orgId: string) {
  return event('checkout.session.completed', { client_reference_id: orgId, customer: 'cus_synthetic', subscription: 'sub_synthetic', metadata: { plan: 'starter' } });
}
const conversions = () => db.prepare('SELECT event_type FROM conversion_events ORDER BY event_type').all();

describe('internal conversion ledger', () => {
  it('records workspace creation once and rolls everything back if its ledger fails', () => {
    const { orgId } = workspace();
    expect(recordTrialStarted(db, orgId)).toBe(false);
    expect(conversions()).toEqual([{ event_type: 'trial_started' }]);
    db.exec(`CREATE TRIGGER reject_conversion BEFORE INSERT ON conversion_events BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
    expect(() => workspace('second@example.org')).toThrow('synthetic failure');
    expect(db.prepare('SELECT COUNT(*) AS n FROM organizations').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });
  });

  it('requires an awarded nonsample workflow with active member owner and a real report date', () => {
    const { orgId, userId } = workspace();
    workflow(orgId, userId);
    const disqualifications = [
      ["UPDATE grants SET is_sample = 1", "UPDATE grants SET is_sample = 0"],
      ["UPDATE organizations SET is_demo = 1", "UPDATE organizations SET is_demo = 0"],
      ["UPDATE grants SET status = 'PROSPECT'", "UPDATE grants SET status = 'AWARDED'"],
      ["UPDATE grants SET archived = 1", "UPDATE grants SET archived = 0"],
      ["UPDATE grants SET awarded_cents = 0", "UPDATE grants SET awarded_cents = 10000"],
      ["UPDATE users SET is_active = 0", "UPDATE users SET is_active = 1"],
      ["UPDATE memberships SET role = 'VIEWER'", "UPDATE memberships SET role = 'OWNER'"],
      ["UPDATE milestones SET type = 'PAYMENT'", "UPDATE milestones SET type = 'REPORT'"],
      ["UPDATE milestones SET status = 'WAIVED'", "UPDATE milestones SET status = 'NOT_STARTED'"],
      ["UPDATE milestones SET due_date = '2026-02-30'", "UPDATE milestones SET due_date = '2026-10-01'"],
      ["UPDATE milestones SET due_date = NULL", "UPDATE milestones SET due_date = '2026-10-01'"],
    ];
    for (const [invalidate, restore] of disqualifications) {
      db.exec(invalidate!);
      expect(recordTrialActivation(db, orgId), invalidate).toBe(false);
      db.exec(restore!);
    }
    expect(recordTrialActivation(db, orgId, new Date('2026-09-02T00:00:00Z'))).toBe(true);
    expect(recordTrialActivation(db, orgId)).toBe(false);
  });

  it('never counts loaded sample data or infers a historical trial start', () => {
    const { orgId, userId } = workspace();
    loadSampleData(db, { orgId, userId, userName: 'Synthetic', today: '2026-09-01', currency: 'USD' });
    expect(recordTrialActivation(db, orgId)).toBe(false);
    db.prepare('DELETE FROM conversion_events').run();
    workflow(orgId, userId);
    expect(recordTrialActivation(db, orgId)).toBe(false);
  });

  it('counts only nonzero verified invoice payment, regardless of earlier checkout or subscription state', () => {
    const { orgId } = workspace();
    applyStripeEvent(db, link(orgId));
    for (const invalid of [invoice({ amount_paid: 0 }), invoice({ paid: false }), invoice({ status: 'open' }), invoice({ paid_out_of_band: true })]) {
      applyStripeEvent(db, event('invoice.paid', invalid));
    }
    expect(conversions()).toEqual([{ event_type: 'trial_started' }]);
    applyStripeEvent(db, { ...event('invoice.paid', invoice({ id: 'in_test' })), livemode: false });
    applyStripeEvent(db, { ...event('invoice.paid', invoice({ id: 'in_unknown' })), livemode: undefined });
    expect(conversions()).toEqual([{ event_type: 'trial_started' }]);
    expect(conversionSummary(db).excludedPaymentFacts).toEqual([{ mode: 'test', facts: 1 }, { mode: 'unknown', facts: 1 }]);
    const paid = event('invoice.paid', invoice(), 'evt_paid');
    applyStripeEvent(db, paid);
    applyStripeEvent(db, paid);
    applyStripeEvent(db, event('invoice.paid', invoice(), 'evt_second_delivery'));
    expect(conversions()).toEqual([{ event_type: 'paid_started' }, { event_type: 'trial_started' }]);
    expect(conversionSummary(db).paymentOutcomes).toEqual([{ kind: 'invoice_paid', status: 'paid', resources: 1, unlinked: 0 }]);
  });

  it('reconciles invoice-before-checkout and retains refund/dispute outcomes without double counting', () => {
    const { orgId } = workspace();
    applyStripeEvent(db, event('refund.updated', { id: 're_synthetic', charge: 'ch_synthetic', amount: 7900, currency: 'usd', status: 'succeeded' }, 'evt_refund_done', 1788480000));
    applyStripeEvent(db, event('charge.dispute.closed', { id: 'dp_synthetic', charge: 'ch_synthetic', amount: 7900, status: 'won', currency: 'usd' }, 'evt_dispute_done', 1788480000));
    applyStripeEvent(db, event('invoice.paid', invoice(), 'evt_invoice_early'));
    expect(conversions()).toEqual([{ event_type: 'trial_started' }]);
    applyStripeEvent(db, link(orgId));
    applyStripeEvent(db, event('refund.created', { id: 're_synthetic', charge: 'ch_synthetic', amount: 7900, status: 'pending' }, 'evt_refund_old', 1788393600));
    applyStripeEvent(db, event('charge.dispute.created', { id: 'dp_synthetic', charge: 'ch_synthetic', amount: 7900, status: 'needs_response' }, 'evt_dispute_old', 1788393600));
    const report = conversionSummary(db);
    expect(report.paymentOutcomes).toEqual(expect.arrayContaining([
      { kind: 'refund', status: 'succeeded', resources: 1, unlinked: 0 },
      { kind: 'dispute', status: 'won', resources: 1, unlinked: 0 },
    ]));
    expect(conversions()).toEqual([{ event_type: 'paid_started' }, { event_type: 'trial_started' }]);
    expect(JSON.stringify(report)).not.toMatch(/cus_synthetic|ch_synthetic|Synthetic Person|synthetic@example/);
  });

  it('supports modern successful-payment events and retains ambiguous invoice.paid without inventing processor evidence', () => {
    const { orgId } = workspace();
    db.prepare("UPDATE organizations SET stripe_subscription_id = 'sub_modern', subscription_status = 'past_due' WHERE id = ?").run(orgId);
    const modern = { id: 'in_modern', parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_modern' } },
      status: 'paid', amount_paid: 7900, currency: 'usd', payments: { data: [{ status: 'paid', amount_paid: 7900, payment: { type: 'payment_intent', payment_intent: 'pi_modern' } }] } };
    applyStripeEvent(db, event('invoice.paid', modern, 'evt_ambiguous'));
    expect(conversions()).toEqual([{ event_type: 'trial_started' }]);
    expect(conversionSummary(db).paymentOutcomes).toContainEqual({ kind: 'invoice_unverified', status: 'payment_mechanism_unknown', resources: 1, unlinked: 0 });
    // A successful payment attempt with the modern invoice shape does not need
    // removed legacy booleans. Duplicate events still mean one first payment.
    applyStripeEvent(db, event('invoice.payment_succeeded', modern, 'evt_modern_paid'));
    applyStripeEvent(db, event('invoice.payment_succeeded', modern, 'evt_modern_paid'));
    expect(conversions()).toEqual([{ event_type: 'paid_started' }, { event_type: 'trial_started' }]);
    expect(db.prepare('SELECT subscription_status FROM organizations WHERE id = ?').get(orgId)).toEqual({ subscription_status: 'active' });
    expect(conversionSummary(db).paymentOutcomes).toEqual([{ kind: 'invoice_paid', status: 'paid', resources: 1, unlinked: 0 }]);
    applyStripeEvent(db, event('refund.updated', { id: 're_modern', payment_intent: 'pi_modern', status: 'succeeded', amount: 7900, currency: 'usd' }));
    expect(conversionSummary(db).paymentOutcomes).toContainEqual({ kind: 'refund', status: 'succeeded', resources: 1, unlinked: 0 });
  });

  it('rejects modern explicit external, zero and partial invoices and leaves multiple payment pointers unresolved', () => {
    const { orgId } = workspace();
    applyStripeEvent(db, link(orgId));
    const modern = { id: 'in_mixed', customer: 'cus_synthetic', status: 'paid', amount_paid: 7900, currency: 'usd' };
    for (const invalid of [{ ...modern, amount_paid_off_stripe: 7900 }, { ...modern, amount_paid: 0 }, { ...modern, status: 'open' }]) {
      applyStripeEvent(db, event('invoice.payment_succeeded', invalid));
    }
    applyStripeEvent(db, event('invoice.paid', invoice({ id: 'in_legacy_unknown', paid_out_of_band: undefined })));
    expect(conversions()).toEqual([{ event_type: 'trial_started' }]);
    applyStripeEvent(db, event('invoice.payment_succeeded', { ...modern, payments: { data: [
      { payment: { type: 'payment_intent', payment_intent: 'pi_first' } },
      { payment: { type: 'payment_intent', payment_intent: 'pi_second' } },
    ] } }));
    applyStripeEvent(db, event('refund.updated', { id: 're_unlinked', payment_intent: 'pi_first', status: 'succeeded', amount: 1000, currency: 'usd' }));
    expect(conversionSummary(db).paymentOutcomes).toContainEqual({ kind: 'refund', status: 'succeeded', resources: 1, unlinked: 1 });
  });

  it('rolls back webhook records and account updates together so a retry can succeed', () => {
    const { orgId } = workspace();
    applyStripeEvent(db, link(orgId));
    db.exec(`CREATE TRIGGER reject_paid BEFORE INSERT ON conversion_events WHEN NEW.event_type = 'paid_started' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
    const paid = event('invoice.paid', invoice(), 'evt_rollback');
    expect(() => applyStripeEvent(db, paid)).toThrow('synthetic failure');
    expect(db.prepare("SELECT COUNT(*) AS n FROM billing_events WHERE stripe_event_id = 'evt_rollback'").get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM payment_facts').get()).toEqual({ n: 0 });
    db.exec('DROP TRIGGER reject_paid');
    applyStripeEvent(db, paid);
    expect(conversions()).toContainEqual({ event_type: 'paid_started' });
  });

  it('separates unreviewed/qualified cohorts, excludes tests, and keeps immature windows out of conversion numerators', () => {
    const { orgId, userId } = workspace();
    workflow(orgId, userId);
    recordTrialActivation(db, orgId, new Date('2026-09-02T00:00:00Z'));
    const immature = conversionSummary(db, new Date('2026-09-03T00:00:00Z'));
    expect(immature.cohorts).toEqual([expect.objectContaining({ trials: 1, maturedSevenDayTrials: 0, activatedWithinSevenDays: 0, acquisitionChannel: 'unknown', landingRoute: null, quality: 'unreviewed' })]);
    expect(conversionSummary(db, new Date('2026-10-03T00:00:00Z')).cohorts).toEqual([expect.objectContaining({ maturedSevenDayTrials: 1, activatedWithinSevenDays: 1, maturedThirtyDayTrials: 1 })]);
    db.prepare("UPDATE organizations SET conversion_quality = 'internal_test'").run();
    const excluded = conversionSummary(db);
    expect(excluded.cohorts).toEqual([]);
    expect(excluded.totals).toEqual([]);
    expect(excluded.excluded).toEqual([{ quality: 'internal_test', organizations: 1 }]);
  });

  it('adds columns to an older database idempotently without rewriting leads', () => {
    db.exec('DROP TABLE leads; CREATE TABLE leads (id TEXT PRIMARY KEY, email TEXT, created_at TEXT); INSERT INTO leads VALUES (\'old\',\'synthetic@example.org\',\'2026-01-01\');');
    migrate(db);
    migrate(db);
    expect(db.prepare('SELECT id, quality_status, receipt_hash FROM leads').get()).toEqual({ id: 'old', quality_status: 'unreviewed', receipt_hash: null });
  });
});
