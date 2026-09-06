/**
 * Plans, trial policy and workspace status.
 *
 * Shared by the API (authoritative enforcement) and the client (rendering the
 * pricing page, the trial banner and the upgrade prompts). Prices are in whole
 * US dollars; Stripe price ids live in server configuration, never here.
 */

export const PLAN_IDS = ['starter', 'growth', 'scale'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Every workspace starts on a full-featured trial of this length. */
export const TRIAL_DAYS = 14;

export interface PlanLimits {
  /** Grants that are not closed, declined or archived. `null` means unlimited. */
  activeGrants: number | null;
  /** Editor seats (owners, managers, members). Viewers are always free. `null` means unlimited. */
  members: number | null;
  /** Evidence storage in megabytes. */
  storageMb: number;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  tagline: string;
  /** Month-to-month price. */
  priceMonthlyUsd: number;
  /** Effective monthly price when billed annually. */
  priceAnnualUsdPerMonth: number;
  limits: PlanLimits;
  /** Bullet points rendered on the pricing page, most important first. */
  features: string[];
  /** Who the tier is for, in one line. */
  audience: string;
  /** Marks the tier the pricing page visually emphasises. */
  recommended?: boolean;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    tagline: 'For the grants manager replacing the spreadsheet and the reminder emails.',
    priceMonthlyUsd: 79,
    priceAnnualUsdPerMonth: 65,
    limits: { activeGrants: 10, members: 3, storageMb: 2_048 },
    audience: 'Nonprofits managing up to 10 active grants',
    features: [
      'Up to 10 active grants',
      '3 editor seats, unlimited viewers (board, auditors, program staff)',
      'Deadlines, deliverables, tasks and a calendar feed',
      'Restricted budgets tracked to the cent against the grant period',
      'Evidence library (2 GB)',
      'Explainable risk signals and funder reporting packets',
      'Spreadsheet import, CSV export',
    ],
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    tagline: 'For teams juggling a real portfolio of restricted awards.',
    priceMonthlyUsd: 179,
    priceAnnualUsdPerMonth: 149,
    limits: { activeGrants: 40, members: 15, storageMb: 10_240 },
    audience: 'Nonprofits managing up to 40 active grants',
    recommended: true,
    features: [
      'Up to 40 active grants',
      '15 editor seats, unlimited viewers',
      'Everything in Starter',
      'Evidence library (10 GB)',
      'Weekly deadline digest for owners and managers',
      'Priority email support and a 20-minute setup call',
    ],
  },
  scale: {
    id: 'scale',
    name: 'Scale',
    tagline: 'For multi-program organizations, fiscal sponsors and consultants.',
    priceMonthlyUsd: 349,
    priceAnnualUsdPerMonth: 290,
    limits: { activeGrants: null, members: null, storageMb: 51_200 },
    audience: 'Organizations with 40+ grants, many programs or several entities',
    features: [
      'Unlimited active grants',
      'Unlimited seats',
      'Everything in Growth',
      'Evidence library (50 GB)',
      'Onboarding call and portfolio import assistance',
      'Invoice or ACH billing and a countersigned data-processing addendum on request',
    ],
  },
};

/** Trials get the Growth limits so a real portfolio fits during evaluation. */
export const TRIAL_LIMITS: PlanLimits = PLANS.growth.limits;

/** Complimentary and demo workspaces are never capped. */
export const UNLIMITED: PlanLimits = { activeGrants: null, members: null, storageMb: 51_200 };

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'complimentary'
  | 'expired'
  | 'demo';

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: 'Free trial',
  active: 'Active subscription',
  past_due: 'Payment past due',
  canceled: 'Canceled',
  complimentary: 'Complimentary',
  expired: 'Trial ended',
  demo: 'Public demo',
};

export interface OrganizationPlanRow {
  plan: string;
  subscription_status: string;
  trial_ends_at: string | null;
  plan_valid_until: string | null;
  is_demo: number;
}

export interface WorkspaceStatus {
  /** The commercial plan the limits come from. `trial` while evaluating. */
  plan: PlanId | 'trial';
  planName: string;
  status: SubscriptionStatus;
  statusLabel: string;
  trialEndsAt: string | null;
  /** Whole days left in the trial, never negative; null when not trialing. */
  trialDaysLeft: number | null;
  /** Paid-through date for canceled or invoiced plans. */
  validUntil: string | null;
  /** True when writes are refused until the workspace subscribes. */
  readOnly: boolean;
  readOnlyReason: string | null;
  limits: PlanLimits;
  isDemo: boolean;
}

function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}

function daysUntil(iso: string, now: Date): number {
  return Math.ceil((new Date(iso).getTime() - now.getTime()) / 86_400_000);
}

/**
 * Pure derivation of what a workspace may do right now. Nothing here talks to
 * the database or Stripe; callers pass the organization row and the clock.
 */
export function computeWorkspaceStatus(org: OrganizationPlanRow, now: Date = new Date()): WorkspaceStatus {
  if (org.is_demo) {
    return {
      plan: 'trial',
      planName: 'Public demo',
      status: 'demo',
      statusLabel: SUBSCRIPTION_STATUS_LABELS.demo,
      trialEndsAt: null,
      trialDaysLeft: null,
      validUntil: null,
      readOnly: false,
      readOnlyReason: null,
      limits: UNLIMITED,
      isDemo: true,
    };
  }

  const plan = isPlanId(org.plan) ? org.plan : null;
  const status = org.subscription_status as SubscriptionStatus;
  const validUntil = org.plan_valid_until;
  const paidThrough = validUntil ? daysUntil(validUntil, now) > 0 : false;

  if (status === 'active' || status === 'past_due') {
    const limits = plan ? PLANS[plan].limits : TRIAL_LIMITS;
    return {
      plan: plan ?? 'trial',
      planName: plan ? PLANS[plan].name : 'Trial',
      status,
      statusLabel: SUBSCRIPTION_STATUS_LABELS[status],
      trialEndsAt: null,
      trialDaysLeft: null,
      validUntil,
      readOnly: false,
      readOnlyReason: null,
      limits,
      isDemo: false,
    };
  }

  if (status === 'complimentary') {
    const stillValid = !validUntil || paidThrough;
    return {
      plan: plan ?? 'trial',
      planName: plan ? PLANS[plan].name : 'Complimentary',
      status: stillValid ? 'complimentary' : 'expired',
      statusLabel: stillValid ? SUBSCRIPTION_STATUS_LABELS.complimentary : SUBSCRIPTION_STATUS_LABELS.expired,
      trialEndsAt: null,
      trialDaysLeft: null,
      validUntil,
      readOnly: !stillValid,
      readOnlyReason: stillValid ? null : 'This workspace’s complimentary period has ended. Choose a plan to keep editing.',
      limits: plan ? PLANS[plan].limits : UNLIMITED,
      isDemo: false,
    };
  }

  if (status === 'canceled') {
    return {
      plan: plan ?? 'trial',
      planName: plan ? PLANS[plan].name : 'Trial',
      status: 'canceled',
      statusLabel: SUBSCRIPTION_STATUS_LABELS.canceled,
      trialEndsAt: null,
      trialDaysLeft: null,
      validUntil,
      readOnly: !paidThrough,
      readOnlyReason: paidThrough
        ? null
        : 'This subscription has ended. Your records are safe and exportable; choose a plan to keep editing.',
      limits: plan ? PLANS[plan].limits : TRIAL_LIMITS,
      isDemo: false,
    };
  }

  // Trialing (the default for a new workspace). A missing trial end date means
  // the workspace predates trials; it is never locked out by accident.
  const trialEndsAt = org.trial_ends_at;
  const daysLeft = trialEndsAt ? Math.max(0, daysUntil(trialEndsAt, now)) : null;
  const expired = trialEndsAt ? daysUntil(trialEndsAt, now) <= 0 : false;
  return {
    plan: 'trial',
    planName: 'Free trial',
    status: expired ? 'expired' : 'trialing',
    statusLabel: expired ? SUBSCRIPTION_STATUS_LABELS.expired : SUBSCRIPTION_STATUS_LABELS.trialing,
    trialEndsAt,
    trialDaysLeft: expired ? 0 : daysLeft,
    validUntil: null,
    readOnly: expired,
    readOnlyReason: expired
      ? 'Your free trial has ended. Everything you entered is safe and exportable; choose a plan to keep editing.'
      : null,
    limits: TRIAL_LIMITS,
    isDemo: false,
  };
}

/** Formats a whole-dollar price for display. */
export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}

/** Annual savings versus paying monthly, as a percentage rounded to the nearest whole number. */
export function annualSavingsPercent(plan: PlanDefinition): number {
  if (plan.priceMonthlyUsd <= 0) return 0;
  return Math.round((1 - plan.priceAnnualUsdPerMonth / plan.priceMonthlyUsd) * 100);
}
