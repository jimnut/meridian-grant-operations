/** Raw database row shapes and their mappers to wire types. */

import type {
  CurrencyCode,
  DocumentType,
  FunderType,
  GrantStatus,
  MilestoneStatus,
  MilestoneType,
  TaskPriority,
  TaskStatus,
} from '../../shared/constants';
import type { IsoDate } from '../../shared/dates';
import type {
  ActivityEntry,
  BudgetLine,
  Funder,
  FunderContact,
  GrantComment,
  GrantDocument,
  GrantMilestone,
  GrantTask,
} from '../../shared/types';

export interface GrantRow {
  id: string;
  org_id: string;
  funder_id: string;
  owner_user_id: string | null;
  title: string;
  program: string | null;
  status: GrantStatus;
  requested_cents: number;
  awarded_cents: number;
  currency: CurrencyCode;
  probability: number | null;
  purpose: string | null;
  requirements: string | null;
  next_action: string | null;
  notes: string | null;
  application_date: IsoDate | null;
  decision_date: IsoDate | null;
  start_date: IsoDate | null;
  end_date: IsoDate | null;
  renewal_date: IsoDate | null;
  closeout_date: IsoDate | null;
  archived: number;
  created_at: string;
  updated_at: string;
  funder_name: string;
  owner_name: string | null;
}

export interface TaskRow {
  id: string;
  grant_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: IsoDate | null;
  assignee_user_id: string | null;
  assignee_name: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  grant_title?: string;
}

export interface MilestoneRow {
  id: string;
  grant_id: string;
  type: MilestoneType;
  title: string;
  due_date: IsoDate | null;
  status: MilestoneStatus;
  submitted_at: string | null;
  completed_at: string | null;
  required_evidence_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  attached_evidence_count: number;
  grant_title?: string;
}

export interface BudgetRow {
  id: string;
  grant_id: string;
  category: string;
  description: string | null;
  planned_cents: number;
  spent_cents: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  grant_id: string;
  milestone_id: string | null;
  original_name: string;
  storage_key: string;
  doc_type: DocumentType;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string;
  created_at: string;
  uploaded_by_name: string;
  milestone_title: string | null;
}

export interface CommentRow {
  id: string;
  grant_id: string;
  author_user_id: string;
  body: string;
  created_at: string;
  author_name: string;
}

export interface ActivityRow {
  id: string;
  actor_user_id: string | null;
  entity_type: ActivityEntry['entityType'];
  entity_id: string | null;
  grant_id: string | null;
  action: string;
  summary: string;
  created_at: string;
  actor_name: string | null;
  grant_title: string | null;
}

export interface FunderRow {
  id: string;
  name: string;
  type: FunderType;
  focus_areas: string;
  website: string | null;
  notes: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
}

export interface FunderContactRow {
  id: string;
  funder_id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
}

export const GRANT_SELECT = `
  SELECT g.*, f.name AS funder_name, u.name AS owner_name
    FROM grants g
    JOIN funders f ON f.id = g.funder_id AND f.org_id = g.org_id
    LEFT JOIN users u ON u.id = g.owner_user_id
`;

export const TASK_SELECT = `
  SELECT t.id, t.grant_id, t.title, t.description, t.status, t.priority, t.due_date,
         t.assignee_user_id, t.completed_at, t.created_at, t.updated_at,
         u.name AS assignee_name, g.title AS grant_title
    FROM tasks t
    LEFT JOIN users u ON u.id = t.assignee_user_id
    JOIN grants g ON g.id = t.grant_id
`;

export const MILESTONE_SELECT = `
  SELECT m.id, m.grant_id, m.type, m.title, m.due_date, m.status, m.submitted_at, m.completed_at,
         m.required_evidence_count, m.notes, m.created_at, m.updated_at, g.title AS grant_title,
         (SELECT COUNT(*) FROM documents d WHERE d.milestone_id = m.id) AS attached_evidence_count
    FROM milestones m
    JOIN grants g ON g.id = m.grant_id
`;

export const DOCUMENT_SELECT = `
  SELECT d.id, d.grant_id, d.milestone_id, d.original_name, d.storage_key, d.doc_type, d.mime_type,
         d.size_bytes, d.uploaded_by, d.created_at, u.name AS uploaded_by_name, m.title AS milestone_title
    FROM documents d
    JOIN users u ON u.id = d.uploaded_by
    LEFT JOIN milestones m ON m.id = d.milestone_id
`;

export const COMMENT_SELECT = `
  SELECT c.id, c.grant_id, c.author_user_id, c.body, c.created_at, u.name AS author_name
    FROM comments c
    JOIN users u ON u.id = c.author_user_id
`;

export const ACTIVITY_SELECT = `
  SELECT a.id, a.actor_user_id, a.entity_type, a.entity_id, a.grant_id, a.action, a.summary, a.created_at,
         u.name AS actor_name, g.title AS grant_title
    FROM activities a
    LEFT JOIN users u ON u.id = a.actor_user_id
    LEFT JOIN grants g ON g.id = a.grant_id
`;

export function mapTask(row: TaskRow): GrantTask {
  return {
    id: row.id,
    grantId: row.grant_id,
    grantTitle: row.grant_title,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    assigneeUserId: row.assignee_user_id,
    assigneeName: row.assignee_name,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapMilestone(row: MilestoneRow): GrantMilestone {
  return {
    id: row.id,
    grantId: row.grant_id,
    grantTitle: row.grant_title,
    type: row.type,
    title: row.title,
    dueDate: row.due_date,
    status: row.status,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
    requiredEvidenceCount: row.required_evidence_count,
    attachedEvidenceCount: row.attached_evidence_count,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapBudgetLine(row: BudgetRow): BudgetLine {
  return {
    id: row.id,
    grantId: row.grant_id,
    category: row.category,
    description: row.description,
    plannedCents: row.planned_cents,
    spentCents: row.spent_cents,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapDocument(row: DocumentRow): GrantDocument {
  return {
    id: row.id,
    grantId: row.grant_id,
    milestoneId: row.milestone_id,
    milestoneTitle: row.milestone_title,
    originalName: row.original_name,
    docType: row.doc_type,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    uploadedByUserId: row.uploaded_by,
    uploadedByName: row.uploaded_by_name,
    createdAt: row.created_at,
  };
}

export function mapComment(row: CommentRow): GrantComment {
  return {
    id: row.id,
    grantId: row.grant_id,
    authorUserId: row.author_user_id,
    authorName: row.author_name,
    body: row.body,
    createdAt: row.created_at,
  };
}

export function mapActivity(row: ActivityRow): ActivityEntry {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name ?? 'System',
    entityType: row.entity_type,
    entityId: row.entity_id,
    grantId: row.grant_id,
    grantTitle: row.grant_title,
    action: row.action,
    summary: row.summary,
    createdAt: row.created_at,
  };
}

export function mapFunder(row: FunderRow): Funder {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    focusAreas: row.focus_areas ? row.focus_areas.split('|').filter(Boolean) : [],
    website: row.website,
    notes: row.notes,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapFunderContact(row: FunderContactRow): FunderContact {
  return {
    id: row.id,
    funderId: row.funder_id,
    name: row.name,
    title: row.title,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    createdAt: row.created_at,
  };
}
