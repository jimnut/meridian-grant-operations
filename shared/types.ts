/** Wire types shared by the API and the client. */

import type {
  ActivityEntityType,
  CurrencyCode,
  DocumentType,
  FunderType,
  GrantStage,
  GrantStatus,
  HealthLevel,
  MilestoneStatus,
  MilestoneType,
  Role,
  TaskPriority,
  TaskStatus,
} from './constants';
import type { IsoDate } from './dates';
import type { PlanDefinition, PlanId, WorkspaceStatus } from './plans';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export interface SessionOrganization {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: CurrencyCode;
  fiscalYearStartMonth: number;
}

export interface SessionPayload {
  user: SessionUser;
  organization: SessionOrganization;
  role: Role;
  capabilities: string[];
  csrfToken: string;
  /** Today's date resolved in the organization timezone. */
  today: IsoDate;
  memberships: Array<{ organizationId: string; organizationName: string; role: Role }>;
  /** Plan, trial and read-only state of the active organization. */
  workspace: WorkspaceStatus;
}

export interface Invite {
  id: string;
  email: string | null;
  role: Role;
  createdByName: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  /** Only present in the creation response; the token is never stored in clear. */
  url?: string;
}

export interface InvitePreview {
  organizationName: string;
  role: Role;
  email: string | null;
  invitedBy: string | null;
  expiresAt: string;
  /** True when a signed-in user should simply join rather than register. */
  requiresAccount: boolean;
}

export interface WorkspaceUsage {
  activeGrants: number;
  members: number;
  pendingInvites: number;
  storageBytes: number;
}

export interface BillingSummary {
  workspace: WorkspaceStatus;
  usage: WorkspaceUsage;
  plans: PlanDefinition[];
  /** Stripe Checkout is wired up and can start a subscription online. */
  checkoutAvailable: boolean;
  /** A Stripe customer exists, so the self-service portal can be opened. */
  portalAvailable: boolean;
  billingEmail: string | null;
  supportEmail: string;
  currentPlan: PlanId | 'trial';
  /** Launch discount for the first organizations to subscribe; `remaining` is 0 once it is used up. */
  foundingOffer: { percentOff: number; durationMonths: number; remaining: number };
}

export interface OnboardingStatus {
  funders: number;
  grants: number;
  members: number;
  milestones: number;
  documents: number;
  calendarConnected: boolean;
  hasSampleData: boolean;
  dismissed: boolean;
}

export interface ImportRowResult {
  row: number;
  title: string;
  outcome: 'created' | 'skipped' | 'error';
  message: string | null;
  grantId: string | null;
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: number;
  fundersCreated: number;
  rows: ImportRowResult[];
}

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  joinedAt: string;
  openTaskCount: number;
  grantCount: number;
}

export interface FunderContact {
  id: string;
  funderId: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  createdAt: string;
}

export interface Funder {
  id: string;
  name: string;
  type: FunderType;
  focusAreas: string[];
  website: string | null;
  notes: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FunderSummary extends Funder {
  contacts: FunderContact[];
  activeGrantCount: number;
  totalGrantCount: number;
  awardedCents: number;
  /** Awarded value of active grants whose renewal or end date lands in the next 12 months. */
  renewalExposureCents: number;
  nextDeadline: DeadlineRef | null;
}

export interface DeadlineRef {
  kind: 'TASK' | 'MILESTONE' | 'GRANT_END' | 'RENEWAL' | 'CLOSEOUT' | 'DECISION';
  id: string;
  title: string;
  date: IsoDate;
}

export interface HealthReason {
  code: string;
  severity: 'RISK' | 'WATCH' | 'GOOD';
  label: string;
  detail: string;
}

export interface GrantHealth {
  level: HealthLevel;
  score: number;
  reasons: HealthReason[];
}

export interface ReadinessBreakdown {
  /** 0-100. */
  percent: number;
  openReportCount: number;
  evidenceRequired: number;
  evidenceAttached: number;
  blockingTaskCount: number;
  detail: string;
}

export interface BudgetTotals {
  plannedCents: number;
  spentCents: number;
  remainingCents: number;
  spentPercent: number;
  /** Percentage of the grant period elapsed, 0-100, or null when the period is unknown. */
  elapsedPercent: number | null;
  variancePoints: number | null;
  lineCount: number;
}

export interface GrantListItem {
  id: string;
  title: string;
  program: string | null;
  status: GrantStatus;
  stage: GrantStage;
  funderId: string;
  funderName: string;
  ownerUserId: string | null;
  ownerName: string | null;
  requestedCents: number;
  awardedCents: number;
  currency: CurrencyCode;
  probability: number | null;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  renewalDate: IsoDate | null;
  archived: boolean;
  nextDeadline: DeadlineRef | null;
  health: GrantHealth;
  readiness: ReadinessBreakdown;
  budget: BudgetTotals;
  openTaskCount: number;
  overdueCount: number;
  updatedAt: string;
}

export interface GrantTask {
  id: string;
  grantId: string;
  grantTitle?: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: IsoDate | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GrantMilestone {
  id: string;
  grantId: string;
  grantTitle?: string;
  type: MilestoneType;
  title: string;
  dueDate: IsoDate | null;
  status: MilestoneStatus;
  submittedAt: string | null;
  completedAt: string | null;
  requiredEvidenceCount: number;
  attachedEvidenceCount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetLine {
  id: string;
  grantId: string;
  category: string;
  description: string | null;
  plannedCents: number;
  spentCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface GrantDocument {
  id: string;
  grantId: string;
  milestoneId: string | null;
  milestoneTitle: string | null;
  originalName: string;
  docType: DocumentType;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  uploadedByName: string;
  createdAt: string;
}

export interface GrantComment {
  id: string;
  grantId: string;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface ActivityEntry {
  id: string;
  actorUserId: string | null;
  actorName: string;
  entityType: ActivityEntityType;
  entityId: string | null;
  grantId: string | null;
  grantTitle: string | null;
  action: string;
  summary: string;
  createdAt: string;
}

export interface GrantDetail extends GrantListItem {
  purpose: string | null;
  requirements: string | null;
  nextAction: string | null;
  notes: string | null;
  applicationDate: IsoDate | null;
  decisionDate: IsoDate | null;
  closeoutDate: IsoDate | null;
  funder: Funder;
  contacts: FunderContact[];
  tasks: GrantTask[];
  milestones: GrantMilestone[];
  budgetLines: BudgetLine[];
  documents: GrantDocument[];
  comments: GrantComment[];
  activity: ActivityEntry[];
}

export interface AttentionItem {
  id: string;
  grantId: string;
  grantTitle: string;
  funderName: string;
  severity: 'RISK' | 'WATCH';
  headline: string;
  reason: string;
  dueDate: IsoDate | null;
  ownerName: string | null;
  kind: string;
}

export interface CalendarEvent {
  id: string;
  kind: 'TASK' | 'MILESTONE' | 'GRANT_END' | 'RENEWAL' | 'CLOSEOUT' | 'APPLICATION' | 'DECISION';
  title: string;
  date: IsoDate;
  grantId: string;
  grantTitle: string;
  funderName: string;
  ownerName: string | null;
  status: string;
  statusLabel: string;
  complete: boolean;
}

export interface DashboardStat {
  key: string;
  label: string;
  value: string;
  helper: string;
  tone: 'neutral' | 'positive' | 'attention' | 'risk';
}

export interface StageBreakdown {
  status: GrantStatus;
  count: number;
  valueCents: number;
}

export interface DashboardPayload {
  today: IsoDate;
  fiscalYear: { label: string; start: IsoDate; end: IsoDate };
  currency: CurrencyCode;
  totals: {
    activeAwardedCents: number;
    activeGrantCount: number;
    restrictedSpentCents: number;
    restrictedRemainingCents: number;
    restrictedPlannedCents: number;
    burnPercent: number;
    readinessPercent: number;
    readinessOpenReports: number;
    atRiskCount: number;
    watchCount: number;
    onTrackCount: number;
    reportsDue30: number;
    renewalsDue90: number;
    renewalExposureCents: number;
    overdueCount: number;
    awardedThisFiscalYearCents: number;
    weightedPipelineCents: number;
    pipelineCount: number;
  };
  stageBreakdown: StageBreakdown[];
  healthBreakdown: Array<{ level: HealthLevel; count: number; valueCents: number }>;
  attention: AttentionItem[];
  upcoming: CalendarEvent[];
  activity: ActivityEntry[];
}

export interface PortfolioReport {
  today: IsoDate;
  currency: CurrencyCode;
  fiscalYear: { label: string; start: IsoDate; end: IsoDate };
  filters: { status: string | null; ownerUserId: string | null; funderId: string | null; health: string | null };
  totals: {
    grantCount: number;
    requestedCents: number;
    awardedCents: number;
    plannedCents: number;
    spentCents: number;
    remainingCents: number;
    weightedPipelineCents: number;
    awardedThisFiscalYearCents: number;
    renewalExposureCents: number;
  };
  byStatus: StageBreakdown[];
  byFunder: Array<{ funderId: string; funderName: string; count: number; awardedCents: number }>;
  byOwner: Array<{ ownerUserId: string | null; ownerName: string; count: number; awardedCents: number }>;
  readiness: Array<{
    grantId: string;
    grantTitle: string;
    funderName: string;
    readinessPercent: number;
    health: HealthLevel;
    nextReportDate: IsoDate | null;
    missingEvidence: number;
  }>;
  reportSchedule: Array<{
    grantId: string;
    grantTitle: string;
    funderName: string;
    milestoneId: string;
    milestoneTitle: string;
    type: MilestoneType;
    dueDate: IsoDate;
    status: MilestoneStatus;
    ownerName: string | null;
    evidenceAttached: number;
    evidenceRequired: number;
  }>;
}

export interface ReportingPacket {
  generatedAt: string;
  organization: SessionOrganization;
  grant: GrantDetail;
  budgetTotals: BudgetTotals;
  evidenceChecklist: Array<{
    milestoneId: string;
    milestoneTitle: string;
    type: MilestoneType;
    dueDate: IsoDate | null;
    status: MilestoneStatus;
    required: number;
    attached: number;
    documents: Array<{ id: string; name: string; docType: DocumentType; uploadedAt: string; uploadedBy: string }>;
  }>;
  openRisks: HealthReason[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface ApiErrorBody {
  error: {
    message: string;
    code: string;
    fields?: Record<string, string>;
  };
}
