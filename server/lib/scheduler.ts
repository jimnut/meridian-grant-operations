/**
 * In-process scheduled work for a single instance: trial reminders, the
 * Monday deadline digest and the daily public-demo reset. Every job is
 * idempotent through `notification_log` / `schema_meta`, so a restart never
 * double-sends, and email jobs are silently skipped when no provider exists.
 */

import { config } from '../config';
import type { Db } from '../db/connection';
import { resetDemoWorkspaces } from '../db/seed';
import { mailerConfigured, renderHtml, sendMail } from './mailer';
import { newId } from './ids';
import { loadCalendarEvents } from '../services/calendar';
import { addDays, daysBetween, todayInTimezone } from '../../shared/dates';
import { computeWorkspaceStatus } from '../../shared/plans';

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  plan: string;
  subscription_status: string;
  trial_ends_at: string | null;
  plan_valid_until: string | null;
  is_demo: number;
}

interface Recipient {
  name: string;
  email: string;
}

function recipients(db: Db, orgId: string): Recipient[] {
  return db
    .prepare(
      `SELECT u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.org_id = ? AND u.is_active = 1 AND m.role IN ('OWNER', 'MANAGER') ORDER BY m.role, u.name`,
    )
    .all(orgId) as Recipient[];
}

function alreadySent(db: Db, orgId: string, kind: string, periodKey: string, to: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 AS ok FROM notification_log WHERE org_id = ? AND kind = ? AND period_key = ?').get(orgId, kind, `${periodKey}:${to}`),
  );
}

function markSent(db: Db, orgId: string, kind: string, periodKey: string, to: string, now: Date): void {
  db.prepare('INSERT OR IGNORE INTO notification_log (id, org_id, kind, period_key, sent_to, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    newId('ntf'),
    orgId,
    kind,
    `${periodKey}:${to}`,
    to,
    now.toISOString(),
  );
}

function liveOrganizations(db: Db): OrgRow[] {
  return db
    .prepare('SELECT id, name, slug, timezone, plan, subscription_status, trial_ends_at, plan_valid_until, is_demo FROM organizations WHERE is_demo = 0')
    .all() as OrgRow[];
}

/** Three days before a trial ends, and again on the day it ends. */
export async function sendTrialReminders(db: Db, now: Date = new Date()): Promise<number> {
  if (!mailerConfigured()) return 0;
  let sent = 0;
  for (const org of liveOrganizations(db)) {
    if (!org.trial_ends_at) continue;
    const status = computeWorkspaceStatus(org, now);
    if (status.status !== 'trialing' && status.status !== 'expired') continue;
    const daysLeft = Math.ceil((new Date(org.trial_ends_at).getTime() - now.getTime()) / 86_400_000);
    const kind = daysLeft <= 0 ? 'trial_expired' : daysLeft <= 3 ? 'trial_ending' : null;
    if (!kind) continue;
    if (kind === 'trial_expired' && daysLeft < -2) continue; // do not nag weeks later
    for (const person of recipients(db, org.id)) {
      if (alreadySent(db, org.id, kind, org.trial_ends_at, person.email)) continue;
      const pricing = `${config.appUrl}/settings/billing`;
      const message =
        kind === 'trial_ending'
          ? {
              subject: `Your GrantConsole trial for ${org.name} ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
              text: `Hi ${person.name},\n\nThe free trial for ${org.name} ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. After that the workspace becomes read-only: nothing is deleted and exports keep working, but edits pause until a plan is chosen.\n\nChoose a plan: ${pricing}\n\nQuestions or need an invoice instead of a card? Reply to this email.`,
              html: renderHtml(
                `Your trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
                [
                  `The free trial for ${org.name} ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. After that the workspace becomes read-only: nothing is deleted and exports keep working, but edits pause until a plan is chosen.`,
                  'Questions, or need an invoice instead of a card? Reply to this email.',
                ],
                { label: 'Choose a plan', url: pricing },
              ),
            }
          : {
              subject: `Your GrantConsole trial for ${org.name} has ended`,
              text: `Hi ${person.name},\n\nThe free trial for ${org.name} has ended, so the workspace is now read-only. Your grants, deadlines, budgets and evidence are all still there and exportable.\n\nPick up where you left off: ${pricing}\n\nIf GrantConsole was not the right fit, reply and tell us why — it genuinely helps.`,
              html: renderHtml(
                'Your trial has ended',
                [
                  `The free trial for ${org.name} has ended, so the workspace is now read-only. Your grants, deadlines, budgets and evidence are all still there and exportable.`,
                  'If GrantConsole was not the right fit, reply and tell us why — it genuinely helps.',
                ],
                { label: 'Choose a plan', url: pricing },
              ),
            };
      const result = await sendMail({ to: person.email, ...message });
      if (result.sent) {
        markSent(db, org.id, kind, org.trial_ends_at, person.email, now);
        sent += 1;
      }
    }
  }
  return sent;
}

/** Monday morning digest of overdue work and everything due in the next 14 days. */
export async function sendWeeklyDigests(db: Db, now: Date = new Date()): Promise<number> {
  if (!mailerConfigured()) return 0;
  let sent = 0;
  for (const org of liveOrganizations(db)) {
    const today = todayInTimezone(org.timezone, now);
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    if (weekday !== 1) continue; // Monday in the organization's own timezone
    const status = computeWorkspaceStatus(org, now);
    if (status.readOnly) continue;

    const horizon = addDays(today, 14);
    const events = loadCalendarEvents(db, org.id, { to: horizon, includeComplete: false }).filter((e) => !e.complete);
    const overdue = events.filter((e) => e.date < today);
    const upcoming = events.filter((e) => e.date >= today && e.date <= horizon);
    if (overdue.length === 0 && upcoming.length === 0) continue;

    const line = (e: (typeof events)[number]) =>
      `• ${e.title} — ${e.grantTitle} (${e.date}${e.date < today ? `, ${daysBetween(e.date, today)} days overdue` : ''})`;
    const text = [
      `Hi,`,
      '',
      `Here is the week ahead for ${org.name}.`,
      '',
      overdue.length ? `OVERDUE (${overdue.length})` : null,
      ...overdue.map(line),
      overdue.length ? '' : null,
      `DUE IN THE NEXT 14 DAYS (${upcoming.length})`,
      ...(upcoming.length ? upcoming.map(line) : ['• Nothing due.']),
      '',
      `Open the calendar: ${config.appUrl}/calendar`,
      '',
      'You receive this because you are an owner or manager of this workspace.',
    ]
      .filter((part): part is string => part !== null)
      .join('\n');
    const paragraphs = [
      `Here is the week ahead for ${org.name}.`,
      overdue.length ? `Overdue (${overdue.length}): ${overdue.map((e) => `${e.title} — ${e.grantTitle} (${e.date})`).join('; ')}` : 'Nothing is overdue.',
      upcoming.length ? `Due in the next 14 days (${upcoming.length}): ${upcoming.map((e) => `${e.title} — ${e.grantTitle} (${e.date})`).join('; ')}` : 'Nothing else is due in the next 14 days.',
    ];

    for (const person of recipients(db, org.id)) {
      if (alreadySent(db, org.id, 'digest', today, person.email)) continue;
      const result = await sendMail({
        to: person.email,
        subject: `${org.name}: ${overdue.length ? `${overdue.length} overdue, ` : ''}${upcoming.length} due in the next 14 days`,
        text,
        html: renderHtml('Your grant week ahead', paragraphs, { label: 'Open the calendar', url: `${config.appUrl}/calendar` }),
      });
      if (result.sent) {
        markSent(db, org.id, 'digest', today, person.email, now);
        sent += 1;
      }
    }
  }
  return sent;
}

/** Once a day at the configured UTC hour, put the public demo back to its seeded state. */
export async function resetDemoIfDue(db: Db, now: Date = new Date()): Promise<boolean> {
  if (!config.demoMode) return false;
  if (now.getUTCHours() !== config.demoResetHourUtc) return false;
  const todayKey = now.toISOString().slice(0, 10);
  const last = db.prepare("SELECT value FROM schema_meta WHERE key = 'demo_reset_date'").get() as { value: string } | undefined;
  if (last?.value === todayKey) return false;
  await resetDemoWorkspaces(db, { now });
  db.prepare("INSERT INTO schema_meta (key, value) VALUES ('demo_reset_date', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(todayKey);
  console.info(`[scheduler] public demo reset to seed state (${todayKey})`);
  return true;
}

export async function runScheduledJobs(db: Db, now: Date = new Date()): Promise<{ reminders: number; digests: number; demoReset: boolean }> {
  const reminders = await sendTrialReminders(db, now).catch((error: unknown) => {
    console.error('[scheduler] trial reminders failed:', error);
    return 0;
  });
  const digests = await sendWeeklyDigests(db, now).catch((error: unknown) => {
    console.error('[scheduler] digests failed:', error);
    return 0;
  });
  const demoReset = await resetDemoIfDue(db, now).catch((error: unknown) => {
    console.error('[scheduler] demo reset failed:', error);
    return false;
  });
  return { reminders, digests, demoReset };
}

/** Starts the ticker. Returns a stop function; never runs under test. */
export function startScheduler(db: Db, intervalMs = 15 * 60 * 1000): () => void {
  const timer = setInterval(() => {
    void runScheduledJobs(db);
  }, intervalMs);
  timer.unref();
  // First pass shortly after boot so a restart never skips a whole day.
  const kickoff = setTimeout(() => void runScheduledJobs(db), 20_000);
  kickoff.unref();
  return () => {
    clearInterval(timer);
    clearTimeout(kickoff);
  };
}
