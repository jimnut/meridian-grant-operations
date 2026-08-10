/** Tasks, deliverables, budget lines, comments and evidence — all nested under a grant. */

import { Router } from 'express';
import multer from 'multer';

import { config } from '../config';
import { currentSession, requireCapability } from '../auth/middleware';
import { logActivity } from '../lib/activity';
import { badRequest, notFound } from '../lib/errors';
import {
  ALLOWED_TYPE_SUMMARY,
  assertAllowedUpload,
  extensionOf,
  buildStorageKey,
  contentDispositionFilename,
  deleteUpload,
  formatBytes,
  readUpload,
  sanitizeFilename,
  writeUpload,
} from '../lib/files';
import { assertContentMatchesType } from '../lib/file-contents';
import { handler, parseBody } from '../lib/http';
import { newId } from '../lib/ids';
import {
  budgetLineSchema,
  commentSchema,
  documentMetaSchema,
  milestonePatchSchema,
  milestoneSchema,
  taskPatchSchema,
  taskSchema,
} from '../lib/validation';
import type { Db } from '../db/connection';
import {
  DOCUMENT_SELECT,
  MILESTONE_SELECT,
  TASK_SELECT,
  mapDocument,
  mapMilestone,
  mapTask,
  type DocumentRow,
  type MilestoneRow,
  type TaskRow,
} from '../services/rows';
import {
  MILESTONE_STATUS_LABELS,
  MILESTONE_TYPE_LABELS,
  TASK_STATUS_LABELS,
  type MilestoneStatus,
  type TaskStatus,
} from '../../shared/constants';
import { formatCents } from '../../shared/money';

const router = Router({ mergeParams: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10 },
});

interface GrantRef {
  id: string;
  title: string;
  orgId: string;
}

/** Resolves the grant and proves tenant ownership. 404 for foreign IDs. */
function grantRef(req: Parameters<typeof currentSession>[0]): GrantRef {
  const session = currentSession(req);
  const grantId = (req.params as Record<string, string>).grantId;
  if (!grantId) throw notFound('Grant');
  const row = req.db.prepare('SELECT id, title FROM grants WHERE org_id = ? AND id = ?').get(session.orgId, grantId) as
    | { id: string; title: string }
    | undefined;
  if (!row) throw notFound('Grant');
  return { id: row.id, title: row.title, orgId: session.orgId };
}

function assertMember(db: Db, orgId: string, userId: string | null): void {
  if (!userId) return;
  const row = db.prepare('SELECT 1 AS ok FROM memberships WHERE org_id = ? AND user_id = ?').get(orgId, userId);
  if (!row) throw notFound('Assignee');
}

function touchGrant(db: Db, orgId: string, grantId: string): void {
  db.prepare('UPDATE grants SET updated_at = ? WHERE id = ? AND org_id = ?').run(
    new Date().toISOString(),
    grantId,
    orgId,
  );
}

/* -------------------------------------------------------------------- tasks */

router.get(
  '/tasks',
  handler((req, res) => {
    const grant = grantRef(req);
    const rows = req.db
      .prepare(`${TASK_SELECT} WHERE t.org_id = ? AND t.grant_id = ? ORDER BY t.created_at DESC`)
      .all(grant.orgId, grant.id) as TaskRow[];
    res.json(rows.map(mapTask));
  }),
);

router.post(
  '/tasks',
  requireCapability('tasks:write'),
  handler((req, res) => {
    const session = currentSession(req);
    const grant = grantRef(req);
    const input = parseBody(taskSchema, req.body);
    assertMember(req.db, grant.orgId, input.assigneeUserId);

    const id = newId('tsk');
    const now = new Date().toISOString();
    req.db
      .prepare(
        `INSERT INTO tasks (id, org_id, grant_id, assignee_user_id, title, description, status, priority, due_date,
            completed_at, created_at, updated_at)
         VALUES (@id, @orgId, @grantId, @assigneeUserId, @title, @description, @status, @priority, @dueDate,
            @completedAt, @now, @now)`,
      )
      .run({
        id,
        orgId: grant.orgId,
        grantId: grant.id,
        now,
        completedAt: input.status === 'DONE' ? now : null,
        ...input,
      });

    touchGrant(req.db, grant.orgId, grant.id);
    logActivity(req.db, {
      orgId: grant.orgId,
      actorUserId: session.userId,
      entityType: 'TASK',
      entityId: id,
      grantId: grant.id,
      action: 'CREATED',
      summary: `Added task “${input.title}”`,
    });

    res.status(201).json(loadTask(req.db, grant.orgId, id));
  }),
);

router.patch(
  '/tasks/:taskId',
  requireCapability('tasks:write'),
  handler((req, res) => {
    const session = currentSession(req);
    const grant = grantRef(req);
    const taskId = req.params.taskId!;
    const existing = req.db
      .prepare('SELECT * FROM tasks WHERE org_id = ? AND grant_id = ? AND id = ?')
      .get(grant.orgId, grant.id, taskId) as
      | { id: string; title: string; status: TaskStatus; completed_at: string | null }
      | undefined;
    if (!existing) throw notFound('Task');

    const patch = parseBody(taskPatchSchema, req.body);
    if (patch.assigneeUserId !== undefined) assertMember(req.db, grant.orgId, patch.assigneeUserId);

    const now = new Date().toISOString();
    const nextStatus = patch.status ?? existing.status;
    const completedAt =
      nextStatus === 'DONE' ? (existing.completed_at ?? now) : nextStatus !== existing.status ? null : existing.completed_at;

    req.db
      .prepare(
        `UPDATE tasks SET
            title = COALESCE(@title, title),
            description = CASE WHEN @descriptionSet = 1 THEN @description ELSE description END,
            status = @status,
            priority = COALESCE(@priority, priority),
            due_date = CASE WHEN @dueDateSet = 1 THEN @dueDate ELSE due_date END,
            assignee_user_id = CASE WHEN @assigneeSet = 1 THEN @assigneeUserId ELSE assignee_user_id END,
            completed_at = @completedAt,
            updated_at = @now
          WHERE id = @id AND org_id = @orgId`,
      )
      .run({
        id: taskId,
        orgId: grant.orgId,
        now,
        title: patch.title ?? null,
        description: patch.description ?? null,
        descriptionSet: patch.description !== undefined ? 1 : 0,
        status: nextStatus,
        priority: patch.priority ?? null,
        dueDate: patch.dueDate ?? null,
        dueDateSet: patch.dueDate !== undefined ? 1 : 0,
        assigneeUserId: patch.assigneeUserId ?? null,
        assigneeSet: patch.assigneeUserId !== undefined ? 1 : 0,
        completedAt,
      });

    touchGrant(req.db, grant.orgId, grant.id);
    if (patch.status && patch.status !== existing.status) {
      logActivity(req.db, {
        orgId: grant.orgId,
        actorUserId: session.userId,
        entityType: 'TASK',
        entityId: taskId,
        grantId: grant.id,
        action: 'STATUS_CHANGED',
        summary: `Task “${existing.title}” moved to ${TASK_STATUS_LABELS[patch.status]}`,
      });
    } else {
      logActivity(req.db, {
        orgId: grant.orgId,
        actorUserId: session.userId,
        entityType: 'TASK',
        entityId: taskId,
        grantId: grant.id,
        action: 'UPDATED',
        summary: `Updated task “${patch.title ?? existing.title}”`,
      });
    }

    res.json(loadTask(req.db, grant.orgId, taskId));
  }),
);

router.delete(
  '/tasks/:taskId',
  requireCapability('tasks:write'),
  handler((req, res) => {
    const session = currentSession(req);
    const grant = grantRef(req);
    const taskId = req.params.taskId!;
    const existing = req.db
      .prepare('SELECT title FROM tasks WHERE org_id = ? AND grant_id = ? AND id = ?')
      .get(grant.orgId, grant.id, taskId) as { title: string } | undefined;
    if (!existing) throw notFound('Task');

    req.db.prepare('DELETE FROM tasks WHERE id = ? AND org_id = ?').run(taskId, grant.orgId);
    touchGrant(req.db, grant.orgId, grant.id);
    logActivity(req.db, {
      orgId: grant.orgId,
      actorUserId: session.userId,
      entityType: 'TASK',
      entityId: taskId,
      grantId: grant.id,
      action: 'DELETED',
      summary: `Removed task “${existing.title}”`,
    });
    res.status(204).end();
  }),
);

function loadTask(db: Db, orgId: string, taskId: string) {
  const row = db.prepare(`${TASK_SELECT} WHERE t.org_id = ? AND t.id = ?`).get(orgId, taskId) as TaskRow | undefined;
  if (!row) throw notFound('Task');
  return mapTask(row);
}

/* --------------------------------------------------------------- milestones */

router.post(
  '/milestones',
  requireCapability('milestones:write'),
  handler((req, res) => {
    const session = currentSession(req);
    const grant = grantRef(req);
    const input = parseBody(milestoneSchema, req.body);

    const id = newId('mil');
    const now = new Date().toISOString();
    req.db
      .prepare(
        `INSERT INTO milestones (id, org_id, grant_id, type, title, due_date, status, submitted_at, completed_at,
            required_evidence_count, notes, created_at, updated_at)
         VALUES (@id, @orgId, @grantId, @type, @title, @dueDate, @status, @submittedAt, @completedAt,
            @requiredEvidenceCount, @notes, @now, @now)`,
      )
      .run({
        id,
        orgId: grant.orgId,
        grantId: grant.id,
        now,
        submittedAt: input.status === 'SUBMITTED' || input.status === 'COMPLETE' ? now : null,
        completedAt: input.status === 'COMPLETE' || input.status === 'WAIVED' ? now : null,
        ...input,
      });

    touchGrant(req.db, grant.orgId, grant.id);
    logActivity(req.db, {
      orgId: grant.orgId,
      actorUserId: session.userId,
      entityType: 'MILESTONE',
      entityId: id,
      grantId: grant.id,
      action: 'CREATED',
      summary: `Added ${MILESTONE_TYPE_LABELS[input.type].toLowerCase()} “${input.title}”`,
    });

    res.status(201).json(loadMilestone(req.db, grant.orgId, id));
  }),
);

router.patch(
  '/milestones/:milestoneId',
  requireCapability('milestones:write'),
  handler((req, res) => {
    const session = currentSession(req);
    const grant = grantRef(req);
    const milestoneId = req.params.milestoneId!;
    const existing = req.db
      .prepare('SELECT * FROM milestones WHERE org_id = ? AND grant_id = ? AND id = ?')
      .get(grant.orgId, grant.id, milestoneId) as
      | { id: string; title: string; status: MilestoneStatus; submitted_at: string | null; completed_at: string | null }
      | undefined;
    if (!existing) throw notFound('Deliverable');

    const patch = parseBody(milestonePatchSchema, req.body);
    const now = new Date().toISOString();
    const nextStatus = patch.status ?? existing.status;

    const submittedAt =
      nextStatus === 'SUBMITTED' || nextStatus === 'COMPLETE'
        ? (existing.submitted_at ?? now)
        : nextStatus === 'NOT_STARTED' || nextStatus === 'IN_PROGRESS'
          ? null
          : existing.submitted_at;
    const completedAt =
      nextStatus === 'COMPLETE' || nextStatus === 'WAIVED' ? (existing.completed_at ?? now) : null;

    req.db
      .prepare(
        `UPDATE milestones SET
            type = COALESCE(@type, type),
            title = COALESCE(@title, title),
            due_date = CASE WHEN @dueDateSet = 1 THEN @dueDate ELSE due_date END,
            status = @status,
            required_evidence_count = COALESCE(@requiredEvidenceCount, required_evidence_count),
            notes = CASE WHEN @notesSet = 1 THEN @notes ELSE notes END,
            submitted_at = @submittedAt,
            completed_at = @completedAt,
            updated_at = @now
          WHERE id = @id AND org_id = @orgId`,
      )
      .run({
        id: milestoneId,
        orgId: grant.orgId,
        now,
        type: patch.type ?? null,
        title: patch.title ?? null,
        dueDate: patch.dueDate ?? null,
        dueDateSet: patch.dueDate !== undefined ? 1 : 0,
        status: nextStatus,
        requiredEvidenceCount: patch.requiredEvidenceCount ?? null,
        notes: patch.notes ?? null,
        notesSet: patch.notes !== undefined ? 1 : 0,
        submittedAt,
        completedAt,
      });

    touchGrant(req.db, grant.orgId, grant.id);
    logActivity(req.db, {
      orgId: grant.orgId,
      actorUserId: session.userId,
      entityType: 'MILESTONE',
      entityId: milestoneId,
      grantId: grant.id,
      action: patch.status && patch.status !== existing.status ? 'STATUS_CHANGED' : 'UPDATED',
      summary:
        patch.status && patch.status !== existing.status
          ? `“${existing.title}” marked ${MILESTONE_STATUS_LABELS[patch.status].toLowerCase()}`
          : `Updated deliverable “${patch.title ?? existing.title}”`,
    });

    res.json(loadMilestone(req.db, grant.orgId, milestoneId));
  }),
);

router.delete(
  '/milestones/:milestoneId',
  requireCapability('milestones:write'),
  handler((req, res) => {
    const session = currentSession(req);
    const grant = grantRef(req);
    const milestoneId = req.params.milestoneId!;
    const existing = req.db
      .prepare('SELECT title FROM milestones WHERE org_id = ? AND grant_id = ? AND id = ?')
      .get(grant.orgId, grant.id, milestoneId) as { title: string } | undefined;
    if (!existing) throw notFound('Deliverable');

    req.db.prepare('DELETE FROM milestones WHERE id = ? AND org_id = ?').run(milestoneId, grant.orgId);
    touchGrant(req.db, grant.orgId, grant.id);
    logActivity(req.db, {
      orgId: grant.orgId,
      actorUserId: session.userId,
      entityType: 'MILESTONE',
      entityId: milestoneId,
      grantId: grant.id,
      action: 'DELETED',
      summary: `Removed deliverable “${existing.title}”`,
    });
    res.status(204).end();
  }),
);

function loadMilestone(db: Db, orgId: string, milestoneId: string) {
  const row = db.prepare(`${MILESTONE_SELECT} WHERE m.org_id = ? AND m.id = ?`).get(orgId, milestoneId) as
    | MilestoneRow
    | undefined;
  if (!row) throw notFound('Deliverable');
  return mapMilestone(row);
}

/* ------------------------------------------------------------- budget lines */

router.post(
  '/budget-lines',
  requireCapability('budget:write'),
  handler((req, res) => {
    const session = currentSession(req);
    const grant = grantRef(req);
    const input = parseBody(budgetLineSchema, req.body);

    const id = newId('bud');
    const now = new Date().toISOString();
    const nextOrder = (
      req.db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM budget_lines WHERE grant_id = ?').get(
        grant.id,
      ) as { next: number }
    ).next;

    req.db
      .prepare(
        `INSERT INTO budget_lines (id, org_id, grant_id, category, description, planned_cents, spent_cents,
            sort_order, created_at, updated_at)
         VALUES (@id, @orgId, @grantId, @category, @description, @plannedCents, @spentCents, @sortOrder, @now, @now)`,
      )
      .run({ id, orgId: grant.orgId, grantId: grant.id, sortOrder: nextOrder, now, ...input });

    touchGrant(req.db, grant.orgId, grant.id);
    logActivity(req.db, {
      orgId: grant.orgId,
      actorUserId: session.userId,
      entityType: 'BUDGET_LINE',
      entityId: id,
      grantId: grant.id,
      action: 'CREATED',
      summary: `Added budget line “${input.category}” planned ${formatCents(input.plannedCents)}`,
    });

    res.status(201).json(loadBudgetLine(req.db, grant.orgId, id));
  }),
);

router.put(
  '/budget-lines/:lineId',
  requireCapability('budget:write'),
  handler((req, res) => {
    const session = currentSession(req);
    const grant = grantRef(req);
    const lineId = req.params.lineId!;
    const existing = req.db
      .prepare('SELECT * FROM budget_lines WHERE org_id = ? AND grant_id = ? AND id = ?')
      .get(grant.orgId, grant.id, lineId) as
      | { id: string; category: string; planned_cents: number; spent_cents: number }
      | undefined;
    if (!existing) throw notFound('Budget line');

    const input = parseBody(budgetLineSchema, req.body);
    req.db
      .prepare(
        `UPDATE budget_lines SET category = @category, description = @description, planned_cents = @plannedCents,
            spent_cents = @spentCents, updated_at = @now
          WHERE id = @id AND org_id = @orgId`,
      )
      .run({ id: lineId, orgId: grant.orgId, now: new Date().toISOString(), ...input });

    touchGrant(req.db, grant.orgId, grant.id);
    logActivity(req.db, {
      orgId: grant.orgId,
      actorUserId: session.userId,
      entityType: 'BUDGET_LINE',
      entityId: lineId,
      grantId: grant.id,
      action: 'UPDATED',
      summary: `Updated “${input.category}” — planned ${formatCents(input.plannedCents)}, spent ${formatCents(input.spentCents)}`,
    });

    res.json(loadBudgetLine(req.db, grant.orgId, lineId));
  }),
);

router.delete(
  '/budget-lines/:lineId',
  requireCapability('budget:write'),
  handler((req, res) => {
    const session = currentSession(req);
    const grant = grantRef(req);
    const lineId = req.params.lineId!;
    const existing = req.db
      .prepare('SELECT category FROM budget_lines WHERE org_id = ? AND grant_id = ? AND id = ?')
      .get(grant.orgId, grant.id, lineId) as { category: string } | undefined;
    if (!existing) throw notFound('Budget line');

    req.db.prepare('DELETE FROM budget_lines WHERE id = ? AND org_id = ?').run(lineId, grant.orgId);
    touchGrant(req.db, grant.orgId, grant.id);
    logActivity(req.db, {
      orgId: grant.orgId,
      actorUserId: session.userId,
      entityType: 'BUDGET_LINE',
      entityId: lineId,
      grantId: grant.id,
      action: 'DELETED',
      summary: `Removed budget line “${existing.category}”`,
    });
    res.status(204).end();
  }),
);

function loadBudgetLine(db: Db, orgId: string, lineId: string) {
  const row = db.prepare('SELECT * FROM budget_lines WHERE org_id = ? AND id = ?').get(orgId, lineId) as
    | {
        id: string;
        grant_id: string;
        category: string;
        description: string | null;
        planned_cents: number;
        spent_cents: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) throw notFound('Budget line');
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

/* ----------------------------------------------------------------- comments */

router.post(
  '/comments',
  requireCapability('comments:write'),
  handler((req, res) => {
    const session = currentSession(req);
    const grant = grantRef(req);
    const { body } = parseBody(commentSchema, req.body);

    const id = newId('cmt');
    const now = new Date().toISOString();
    req.db
      .prepare(
        `INSERT INTO comments (id, org_id, grant_id, author_user_id, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, grant.orgId, grant.id, session.userId, body, now);

    logActivity(req.db, {
      orgId: grant.orgId,
      actorUserId: session.userId,
      entityType: 'COMMENT',
      entityId: id,
      grantId: grant.id,
      action: 'CREATED',
      summary: `Added a note`,
    });

    res.status(201).json({
      id,
      grantId: grant.id,
      authorUserId: session.userId,
      authorName: session.userName,
      body,
      createdAt: now,
    });
  }),
);

/* ---------------------------------------------------------------- documents */

router.post(
  '/documents',
  requireCapability('documents:write'),
  upload.single('file'),
  handler((req, res) => {
    const session = currentSession(req);
    const grant = grantRef(req);
    const file = req.file;
    if (!file) {
      throw badRequest(`Choose a file to upload. Accepted formats: ${ALLOWED_TYPE_SUMMARY}.`);
    }
    if (file.size === 0) {
      throw badRequest('That file is empty.');
    }

    const safeName = sanitizeFilename(file.originalname);

    const meta = parseBody(documentMetaSchema, {
      docType: req.body?.docType,
      milestoneId: req.body?.milestoneId,
    });

    assertAllowedUpload(file.originalname, file.mimetype);
    // Extension and MIME are attacker-controlled; verify the bytes agree before
    // anything reaches disk. Multer's memory storage means no temp file exists yet.
    assertContentMatchesType(file.buffer, file.mimetype.split(';')[0]!.trim().toLowerCase(), extensionOf(safeName));

    if (meta.milestoneId) {
      const milestone = req.db
        .prepare('SELECT id FROM milestones WHERE org_id = ? AND grant_id = ? AND id = ?')
        .get(grant.orgId, grant.id, meta.milestoneId);
      if (!milestone) throw notFound('Deliverable');
    }

    const storageKey = buildStorageKey(grant.orgId, file.originalname);
    writeUpload(storageKey, file.buffer, req.uploadsDir);

    const id = newId('doc');
    const now = new Date().toISOString();
    try {
      req.db
        .prepare(
          `INSERT INTO documents (id, org_id, grant_id, milestone_id, uploaded_by, original_name, storage_key,
              doc_type, mime_type, size_bytes, created_at)
           VALUES (@id, @orgId, @grantId, @milestoneId, @uploadedBy, @originalName, @storageKey, @docType,
              @mimeType, @sizeBytes, @now)`,
        )
        .run({
          id,
          orgId: grant.orgId,
          grantId: grant.id,
          milestoneId: meta.milestoneId,
          uploadedBy: session.userId,
          originalName: safeName,
          storageKey,
          docType: meta.docType,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          now,
        });
    } catch (error) {
      deleteUpload(storageKey, req.uploadsDir);
      throw error;
    }

    logActivity(req.db, {
      orgId: grant.orgId,
      actorUserId: session.userId,
      entityType: 'DOCUMENT',
      entityId: id,
      grantId: grant.id,
      action: 'UPLOADED',
      summary: `Uploaded evidence “${safeName}” (${formatBytes(file.size)})`,
    });

    res.status(201).json(loadDocument(req.db, grant.orgId, id));
  }),
);

router.get(
  '/documents/:documentId/download',
  handler((req, res) => {
    const grant = grantRef(req);
    const row = req.db
      .prepare('SELECT * FROM documents WHERE org_id = ? AND grant_id = ? AND id = ?')
      .get(grant.orgId, grant.id, req.params.documentId!) as
      | { storage_key: string; original_name: string; mime_type: string; size_bytes: number }
      | undefined;
    if (!row) throw notFound('Document');

    const contents = readUpload(row.storage_key, req.uploadsDir);
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Content-Length', String(contents.length));
    res.setHeader('Content-Disposition', contentDispositionFilename(row.original_name));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(contents);
  }),
);

router.delete(
  '/documents/:documentId',
  requireCapability('documents:delete'),
  handler((req, res) => {
    const session = currentSession(req);
    const grant = grantRef(req);
    const documentId = req.params.documentId!;
    const row = req.db
      .prepare('SELECT storage_key AS storageKey, original_name AS originalName FROM documents WHERE org_id = ? AND grant_id = ? AND id = ?')
      .get(grant.orgId, grant.id, documentId) as { storageKey: string; originalName: string } | undefined;
    if (!row) throw notFound('Document');

    req.db.prepare('DELETE FROM documents WHERE id = ? AND org_id = ?').run(documentId, grant.orgId);
    deleteUpload(row.storageKey, req.uploadsDir);

    logActivity(req.db, {
      orgId: grant.orgId,
      actorUserId: session.userId,
      entityType: 'DOCUMENT',
      entityId: documentId,
      grantId: grant.id,
      action: 'DELETED',
      summary: `Removed evidence “${row.originalName}”`,
    });
    res.status(204).end();
  }),
);

function loadDocument(db: Db, orgId: string, documentId: string) {
  const row = db.prepare(`${DOCUMENT_SELECT} WHERE d.org_id = ? AND d.id = ?`).get(orgId, documentId) as
    | DocumentRow
    | undefined;
  if (!row) throw notFound('Document');
  return mapDocument(row);
}

export default router;
