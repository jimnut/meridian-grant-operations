import type { Db } from '../db/connection';
import { newId } from './ids';
import type { ActivityEntityType } from '../../shared/constants';

export interface ActivityInput {
  orgId: string;
  actorUserId: string | null;
  entityType: ActivityEntityType;
  entityId: string | null;
  grantId?: string | null;
  action: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only audit trail. Metadata is stored as JSON and is only ever rendered
 * as text, never as markup.
 */
export function logActivity(db: Db, input: ActivityInput, at: Date = new Date()): string {
  const id = newId('act');
  db.prepare(
    `INSERT INTO activities (id, org_id, actor_user_id, entity_type, entity_id, grant_id, action, summary, metadata, created_at)
     VALUES (@id, @orgId, @actorUserId, @entityType, @entityId, @grantId, @action, @summary, @metadata, @createdAt)`,
  ).run({
    id,
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    entityType: input.entityType,
    entityId: input.entityId,
    grantId: input.grantId ?? null,
    action: input.action,
    summary: input.summary.slice(0, 500),
    metadata: input.metadata ? JSON.stringify(input.metadata).slice(0, 4000) : null,
    createdAt: at.toISOString(),
  });
  return id;
}

/** Human sentence for a field change, used to build audit summaries. */
export function describeChanges(
  changes: Array<{ label: string; from: unknown; to: unknown }>,
): string {
  const parts = changes
    .filter((c) => String(c.from ?? '') !== String(c.to ?? ''))
    .map((c) => `${c.label}: ${format(c.from)} → ${format(c.to)}`);
  return parts.join('; ');
}

function format(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'empty';
  return String(value);
}
