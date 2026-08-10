import {
  GRANT_STATUS_LABELS,
  HEALTH_LABELS,
  MILESTONE_STATUS_LABELS,
  MILESTONE_TYPE_LABELS,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type GrantStatus,
  type HealthLevel,
  type MilestoneStatus,
  type MilestoneType,
  type TaskPriority,
  type TaskStatus,
} from '../../shared/constants';
import { classifyDue, formatIsoDate, relativeDueLabel, type IsoDate } from '../../shared/dates';
import { centsToDecimalString, formatCents, formatCentsCompact } from '../../shared/money';

export { formatCents, formatCentsCompact, formatIsoDate, relativeDueLabel, classifyDue, centsToDecimalString };

export type Tone = 'neutral' | 'accent' | 'amber' | 'risk' | 'positive' | 'info' | 'plain';

export const statusTone: Record<GrantStatus, Tone> = {
  PROSPECT: 'plain',
  DRAFTING: 'plain',
  SUBMITTED: 'info',
  AWARDED: 'accent',
  REPORTING: 'accent',
  RENEWAL: 'amber',
  CLOSEOUT: 'amber',
  CLOSED: 'neutral',
  DECLINED: 'neutral',
};

export const healthTone: Record<HealthLevel, Tone> = {
  ON_TRACK: 'positive',
  WATCH: 'amber',
  AT_RISK: 'risk',
};

export const taskStatusTone: Record<TaskStatus, Tone> = {
  TODO: 'plain',
  IN_PROGRESS: 'info',
  BLOCKED: 'risk',
  DONE: 'positive',
};

export const priorityTone: Record<TaskPriority, Tone> = {
  LOW: 'plain',
  MEDIUM: 'neutral',
  HIGH: 'amber',
  URGENT: 'risk',
};

export const milestoneStatusTone: Record<MilestoneStatus, Tone> = {
  NOT_STARTED: 'plain',
  IN_PROGRESS: 'info',
  SUBMITTED: 'accent',
  COMPLETE: 'positive',
  WAIVED: 'neutral',
};

export const labels = {
  status: (s: GrantStatus) => GRANT_STATUS_LABELS[s],
  health: (h: HealthLevel) => HEALTH_LABELS[h],
  taskStatus: (s: TaskStatus) => TASK_STATUS_LABELS[s],
  priority: (p: TaskPriority) => TASK_PRIORITY_LABELS[p],
  milestoneStatus: (s: MilestoneStatus) => MILESTONE_STATUS_LABELS[s],
  milestoneType: (t: MilestoneType) => MILESTONE_TYPE_LABELS[t],
};

/** Initials for avatars — up to two letters, never empty. */
export function initials(name: string | null | undefined): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Tone for a deadline, used consistently by tables, calendar and strips. */
export function dueTone(dueDate: IsoDate | null | undefined, today: IsoDate, complete = false): Tone {
  if (complete) return 'positive';
  const classification = classifyDue(dueDate, today);
  if (classification === 'OVERDUE') return 'risk';
  if (classification === 'DUE_TODAY' || classification === 'DUE_SOON') return 'amber';
  return 'plain';
}

export function formatDateRange(start: IsoDate | null, end: IsoDate | null): string {
  if (!start && !end) return 'No period set';
  if (start && !end) return `From ${formatIsoDate(start)}`;
  if (!start && end) return `Until ${formatIsoDate(end)}`;
  return `${formatIsoDate(start)} – ${formatIsoDate(end)}`;
}

/** "2 of 4 evidence items" style counter. */
export function evidenceLabel(attached: number, required: number): string {
  if (required === 0) return attached === 1 ? '1 file attached' : `${attached} files attached`;
  return `${Math.min(attached, required)} of ${required} evidence items`;
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}
