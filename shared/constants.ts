/** Domain vocabularies shared by the server (authoritative) and the client (labels). */

export const ROLES = ['OWNER', 'MANAGER', 'MEMBER', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: 'Full access, including organization settings and team administration.',
  MANAGER: 'All grant operations plus team roles, except changes to an owner.',
  MEMBER: 'Day-to-day grant work. No team or organization settings.',
  VIEWER: 'Read-only access with exports. Cannot change any record.',
};

export const GRANT_STATUSES = [
  'PROSPECT',
  'DRAFTING',
  'SUBMITTED',
  'AWARDED',
  'REPORTING',
  'RENEWAL',
  'CLOSEOUT',
  'CLOSED',
  'DECLINED',
] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];

export const GRANT_STATUS_LABELS: Record<GrantStatus, string> = {
  PROSPECT: 'Prospect',
  DRAFTING: 'Drafting',
  SUBMITTED: 'Submitted',
  AWARDED: 'Awarded',
  REPORTING: 'Reporting',
  RENEWAL: 'Renewal',
  CLOSEOUT: 'Closeout',
  CLOSED: 'Closed',
  DECLINED: 'Declined',
};

/** Lifecycle grouping used for board columns, pipeline charts and filters. */
export const GRANT_STAGES = ['PIPELINE', 'ACTIVE', 'ENDED'] as const;
export type GrantStage = (typeof GRANT_STAGES)[number];

export const GRANT_STAGE_LABELS: Record<GrantStage, string> = {
  PIPELINE: 'Pipeline',
  ACTIVE: 'Active award',
  ENDED: 'Ended',
};

export const STATUS_STAGE: Record<GrantStatus, GrantStage> = {
  PROSPECT: 'PIPELINE',
  DRAFTING: 'PIPELINE',
  SUBMITTED: 'PIPELINE',
  AWARDED: 'ACTIVE',
  REPORTING: 'ACTIVE',
  RENEWAL: 'ACTIVE',
  CLOSEOUT: 'ACTIVE',
  CLOSED: 'ENDED',
  DECLINED: 'ENDED',
};

/** Statuses that represent money the organization has actually been awarded. */
export const AWARDED_STATUSES: readonly GrantStatus[] = [
  'AWARDED',
  'REPORTING',
  'RENEWAL',
  'CLOSEOUT',
  'CLOSED',
];

/** Statuses with live obligations — the ones that drive risk, readiness and deadlines. */
export const ACTIVE_STATUSES: readonly GrantStatus[] = ['AWARDED', 'REPORTING', 'RENEWAL', 'CLOSEOUT'];

/** Statuses still being pursued — the ones that drive weighted pipeline value. */
export const PIPELINE_STATUSES: readonly GrantStatus[] = ['PROSPECT', 'DRAFTING', 'SUBMITTED'];

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  BLOCKED: 'Blocked',
  DONE: 'Done',
};

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

export const MILESTONE_TYPES = [
  'LOI',
  'APPLICATION',
  'REPORT',
  'FINANCIAL_REPORT',
  'RENEWAL',
  'PAYMENT',
  'SITE_VISIT',
  'OTHER',
] as const;
export type MilestoneType = (typeof MILESTONE_TYPES)[number];

export const MILESTONE_TYPE_LABELS: Record<MilestoneType, string> = {
  LOI: 'Letter of inquiry',
  APPLICATION: 'Application',
  REPORT: 'Narrative report',
  FINANCIAL_REPORT: 'Financial report',
  RENEWAL: 'Renewal',
  PAYMENT: 'Payment',
  SITE_VISIT: 'Site visit',
  OTHER: 'Other',
};

/** Milestone types that count toward reporting readiness. */
export const REPORTING_MILESTONE_TYPES: readonly MilestoneType[] = ['REPORT', 'FINANCIAL_REPORT'];

export const MILESTONE_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'COMPLETE', 'WAIVED'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted',
  COMPLETE: 'Complete',
  WAIVED: 'Waived',
};

/** Milestone statuses that no longer require work. */
export const CLOSED_MILESTONE_STATUSES: readonly MilestoneStatus[] = ['COMPLETE', 'WAIVED'];

export const DOCUMENT_TYPES = [
  'NARRATIVE',
  'FINANCIAL',
  'RECEIPT',
  'AGREEMENT',
  'BUDGET',
  'DATA_EXPORT',
  'CORRESPONDENCE',
  'OTHER',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  NARRATIVE: 'Narrative',
  FINANCIAL: 'Financial statement',
  RECEIPT: 'Receipt / invoice',
  AGREEMENT: 'Grant agreement',
  BUDGET: 'Budget',
  DATA_EXPORT: 'Program data',
  CORRESPONDENCE: 'Correspondence',
  OTHER: 'Other',
};

export const FUNDER_TYPES = [
  'PRIVATE_FOUNDATION',
  'FAMILY_FOUNDATION',
  'COMMUNITY_FOUNDATION',
  'CORPORATE',
  'FEDERAL',
  'STATE',
  'LOCAL',
  'INTERMEDIARY',
  'OTHER',
] as const;
export type FunderType = (typeof FUNDER_TYPES)[number];

export const FUNDER_TYPE_LABELS: Record<FunderType, string> = {
  PRIVATE_FOUNDATION: 'Private foundation',
  FAMILY_FOUNDATION: 'Family foundation',
  COMMUNITY_FOUNDATION: 'Community foundation',
  CORPORATE: 'Corporate giving',
  FEDERAL: 'Federal agency',
  STATE: 'State agency',
  LOCAL: 'Local government',
  INTERMEDIARY: 'Intermediary / re-granter',
  OTHER: 'Other',
};

export const HEALTH_LEVELS = ['ON_TRACK', 'WATCH', 'AT_RISK'] as const;
export type HealthLevel = (typeof HEALTH_LEVELS)[number];

export const HEALTH_LABELS: Record<HealthLevel, string> = {
  ON_TRACK: 'On track',
  WATCH: 'Watch',
  AT_RISK: 'At risk',
};

export const ACTIVITY_ENTITY_TYPES = [
  'GRANT',
  'TASK',
  'MILESTONE',
  'BUDGET_LINE',
  'DOCUMENT',
  'COMMENT',
  'FUNDER',
  'FUNDER_CONTACT',
  'MEMBERSHIP',
  'ORGANIZATION',
] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

/** Horizon constants used by dashboard rollups. Kept here so UI copy and math agree. */
export const HORIZONS = {
  /** "Reports due" window on the dashboard. */
  reportsDueDays: 30,
  /** "Renewals due" window on the dashboard. */
  renewalDays: 90,
  /** A deadline inside this window is "due soon". */
  dueSoonDays: 14,
  /** Reporting readiness only counts reports that are overdue or due inside this window. */
  readinessHorizonDays: 90,
  /** Budget burn may drift this many percentage points before it is flagged. */
  burnTolerancepoints: 15,
} as const;

export const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP'] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
