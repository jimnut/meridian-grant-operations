/**
 * Capability matrix.
 *
 * The server is the authority: every mutation route calls `requireCapability`.
 * The client imports the same table only to decide which affordances to render,
 * so a Viewer never sees a control that would fail on submit.
 */

import type { Role } from './constants';

export const CAPABILITIES = [
  'grants:read',
  'grants:write',
  'grants:archive',
  'funders:write',
  'tasks:write',
  'milestones:write',
  'budget:write',
  'documents:write',
  'documents:delete',
  'comments:write',
  'team:manage',
  'org:manage',
  'export:run',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const OWNER_CAPS: Capability[] = [...CAPABILITIES];

const MANAGER_CAPS: Capability[] = [
  'grants:read',
  'grants:write',
  'grants:archive',
  'funders:write',
  'tasks:write',
  'milestones:write',
  'budget:write',
  'documents:write',
  'documents:delete',
  'comments:write',
  // A manager administers the team but can never remove or transfer the owner —
  // enforced additionally in the team routes.
  'team:manage',
  'export:run',
];

const MEMBER_CAPS: Capability[] = [
  'grants:read',
  'grants:write',
  'grants:archive',
  'funders:write',
  'tasks:write',
  'milestones:write',
  'budget:write',
  'documents:write',
  'comments:write',
  'export:run',
];

const VIEWER_CAPS: Capability[] = ['grants:read', 'export:run'];

export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  OWNER: OWNER_CAPS,
  MANAGER: MANAGER_CAPS,
  MEMBER: MEMBER_CAPS,
  VIEWER: VIEWER_CAPS,
};

export function can(role: Role | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

/** True when the role may change any record at all — used for read-only banners. */
export function isReadOnly(role: Role | null | undefined): boolean {
  return !can(role, 'grants:write');
}

/**
 * Role-change rules, shared by the team UI and the team route.
 * Returns null when allowed, or a human-readable reason when denied.
 */
export function roleChangeDenialReason(params: {
  actorRole: Role;
  actorUserId: string;
  targetRole: Role;
  targetUserId: string;
  nextRole: Role;
  ownerCount: number;
}): string | null {
  const { actorRole, actorUserId, targetRole, targetUserId, nextRole, ownerCount } = params;

  if (!can(actorRole, 'team:manage')) {
    return 'Your role cannot change team members.';
  }
  if (actorUserId === targetUserId && actorRole === 'OWNER' && nextRole !== 'OWNER' && ownerCount <= 1) {
    return 'You are the only owner. Promote another owner before changing your own role.';
  }
  if (actorRole === 'MANAGER' && targetRole === 'OWNER') {
    return 'Only an owner can change an owner’s role.';
  }
  if (actorRole === 'MANAGER' && nextRole === 'OWNER') {
    return 'Only an owner can grant the owner role.';
  }
  if (targetRole === 'OWNER' && nextRole !== 'OWNER' && ownerCount <= 1) {
    return 'An organization must keep at least one owner.';
  }
  return null;
}
