import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Link2, Mail, UserMinus, UserPlus } from 'lucide-react';

import { BRAND } from '../../shared/brand';
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from '../../shared/constants';
import { CAPABILITIES, ROLE_CAPABILITIES } from '../../shared/permissions';
import { formatIsoDate } from '../../shared/dates';
import type { Invite, TeamMember } from '../../shared/types';
import { trackEvent } from '../lib/analytics';
import { api, ApiRequestError } from '../lib/api';
import { useCurrentSession, useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { Avatar, Badge, Card, ErrorState, Field, Input, LoadingState, Select } from '../components/ui';

const CAPABILITY_LABELS: Record<string, string> = {
  'grants:read': 'View grants and reports',
  'grants:write': 'Create and edit grants',
  'grants:archive': 'Archive grants',
  'funders:write': 'Manage funders and contacts',
  'tasks:write': 'Manage tasks',
  'milestones:write': 'Manage deliverables',
  'budget:write': 'Manage budgets',
  'documents:write': 'Upload evidence',
  'documents:delete': 'Delete evidence',
  'comments:write': 'Add notes',
  'team:manage': 'Manage team roles and invitations',
  'org:manage': 'Change organization settings and billing',
  'export:run': 'Export data',
};

type InviteResponse = Invite & { url: string; emailed: boolean };

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function TeamPage() {
  const session = useCurrentSession();
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    document.title = `Team · ${BRAND.titleSuffix}`;
  }, []);

  const canManage = can('team:manage');
  const isDemo = session.workspace.isDemo;

  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['team'], queryFn: () => api.get<TeamMember[]>('/team') });
  const invites = useQuery({ queryKey: ['invites'], queryFn: () => api.get<Invite[]>('/team/invites'), enabled: canManage });

  const [pendingRole, setPendingRole] = useState<{ member: TeamMember; role: Role } | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [linkDialog, setLinkDialog] = useState<{ title: string; description: string; url: string } | null>(null);
  const [inviteForm, setInviteForm] = useState<{ email: string; role: Role }>({ email: '', role: 'MEMBER' });
  const [inviteError, setInviteError] = useState<string | null>(null);

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) => api.patch(`/team/${userId}/role`, { role }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['team'] });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      toast.success('Role updated.');
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : 'That role could not be changed.'),
  });

  const createInvite = useMutation({
    mutationFn: (payload: { email: string | null; role: Role }) => api.post<InviteResponse>('/team/invites', payload),
    onSuccess: async (result) => {
      trackEvent('invite_sent', { role: result.role, emailed: result.emailed });
      setInviteError(null);
      setInviteForm({ email: '', role: 'MEMBER' });
      await queryClient.invalidateQueries({ queryKey: ['invites'] });
      await queryClient.invalidateQueries({ queryKey: ['onboarding'] });
      setLinkDialog({
        title: result.emailed ? 'Invitation sent' : 'Invitation link ready',
        description: result.emailed
          ? `We emailed ${result.email}. You can also share this link directly; it works for 14 days.`
          : result.email
            ? `Email is not switched on for this server, so send this link to ${result.email} yourself. It works for 14 days.`
            : 'Share this link with the person you are inviting. Anyone with it can join, so send it privately. It works for 14 days.',
        url: result.url,
      });
    },
    onError: (error: unknown) => setInviteError(error instanceof ApiRequestError ? error.message : 'The invitation could not be created.'),
  });

  const resendInvite = useMutation({
    mutationFn: (inviteId: string) => api.post<InviteResponse>(`/team/invites/${inviteId}/resend`),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['invites'] });
      setLinkDialog({ title: 'New invitation link', description: result.emailed ? `We emailed ${result.email} a fresh link.` : 'The previous link no longer works. Share this one instead.', url: result.url });
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : 'Could not resend the invitation.'),
  });

  const revokeInvite = useMutation({
    mutationFn: (inviteId: string) => api.delete(`/team/invites/${inviteId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['invites'] });
      toast.success('Invitation revoked.');
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : 'Could not revoke the invitation.'),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.delete(`/team/${userId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['team'] });
      await queryClient.invalidateQueries();
      toast.success('Removed from the organization.');
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : 'Could not remove this person.'),
  });

  const resetLink = useMutation({
    mutationFn: (userId: string) => api.post<{ url: string; expiresAt: string; email: string }>(`/team/${userId}/reset-link`),
    onSuccess: (result) => {
      setLinkDialog({ title: 'Password reset link', description: `Send this to ${result.email} privately. It works once, for one hour.`, url: result.url });
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : 'Could not create a reset link.'),
  });

  return (
    <>
      <header className="page-header">
        <div className="page-header__text">
          <p className="page-header__eyebrow">{session.organization.name}</p>
          <h1 className="page-header__title">Team</h1>
          <p className="page-header__lede">
            Roles decide what each person can change. Permissions are enforced on the server, so a role change takes effect
            everywhere immediately. Viewers are free on every plan.
          </p>
        </div>
      </header>

      <div className="stack stack-5">
        {canManage && !isDemo && (
          <Card title="Invite a teammate" subtitle="Send an email invitation, or create a link to share yourself.">
            <form
              className="stack stack-4"
              onSubmit={(event) => {
                event.preventDefault();
                setInviteError(null);
                createInvite.mutate({ email: inviteForm.email.trim() || null, role: inviteForm.role });
              }}
            >
              {inviteError && (
                <div className="banner banner--risk" role="alert">
                  <div className="small">{inviteError}</div>
                </div>
              )}
              <div className="form-grid">
                <Field label="Email" htmlFor="invite-email" optional hint="Leave blank to create a shareable link.">
                  <Input id="invite-email" type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} placeholder="colleague@organization.org" />
                </Field>
                <Field label="Role" htmlFor="invite-role" hint={ROLE_DESCRIPTIONS[inviteForm.role]}>
                  <Select id="invite-role" value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value as Role })}>
                    {ROLES.filter((role) => role !== 'OWNER' || session.role === 'OWNER').map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button type="submit" className="btn btn--primary" disabled={createInvite.isPending}>
                  {inviteForm.email.trim() ? <Mail size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
                  {createInvite.isPending ? 'Creating…' : inviteForm.email.trim() ? 'Send invitation' : 'Create invite link'}
                </button>
              </div>
            </form>

            {invites.data && invites.data.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 'var(--space-5)' }}>
                <table className="table table--compact">
                  <caption className="visually-hidden">Pending invitations</caption>
                  <thead>
                    <tr>
                      <th scope="col">Invitation</th>
                      <th scope="col">Role</th>
                      <th scope="col">Expires</th>
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invites.data.map((invite) => (
                      <tr key={invite.id}>
                        <td>
                          <span className="table__primary">{invite.email ?? 'Shareable link'}</span>
                          <div className="table__meta">Invited by {invite.createdByName ?? 'a teammate'}</div>
                        </td>
                        <td>
                          <Badge tone="plain">{ROLE_LABELS[invite.role]}</Badge>
                        </td>
                        <td className="small">{formatIsoDate(invite.expiresAt.slice(0, 10))}</td>
                        <td>
                          <div className="row" style={{ justifyContent: 'flex-end' }}>
                            <button type="button" className="btn btn--sm" onClick={() => resendInvite.mutate(invite.id)} disabled={resendInvite.isPending}>
                              {invite.email ? 'Resend' : 'New link'}
                            </button>
                            <button type="button" className="btn btn--sm btn--ghost" onClick={() => revokeInvite.mutate(invite.id)} disabled={revokeInvite.isPending}>
                              Revoke
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {isLoading && (
          <div className="card">
            <LoadingState label="Loading team…" />
          </div>
        )}
        {isError && (
          <div className="card">
            <ErrorState onRetry={() => void refetch()} />
          </div>
        )}

        {data && (
          <Card title="Members" subtitle={`${data.length} people in this organization`} flush>
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">Team members and roles</caption>
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Role</th>
                    <th scope="col" className="table__num">
                      Grants owned
                    </th>
                    <th scope="col" className="table__num">
                      Open tasks
                    </th>
                    <th scope="col">Joined</th>
                    {canManage && (
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.map((member) => {
                    const isSelf = member.userId === session.user.id;
                    const lockedByOwner = member.role === 'OWNER' && session.role !== 'OWNER';
                    return (
                      <tr key={member.userId}>
                        <td>
                          <div className="row">
                            <Avatar name={member.name} large />
                            <span>
                              <span className="table__primary">
                                {member.name}
                                {isSelf && <span className="muted small"> (you)</span>}
                              </span>
                              <div className="table__meta">{member.email}</div>
                            </span>
                          </div>
                        </td>
                        <td>
                          {canManage && !lockedByOwner ? (
                            <>
                              <label className="visually-hidden" htmlFor={`role-${member.userId}`}>
                                Role for {member.name}
                              </label>
                              <Select
                                id={`role-${member.userId}`}
                                value={member.role}
                                disabled={changeRole.isPending}
                                style={{ minWidth: 140 }}
                                onChange={(event) => {
                                  const role = event.target.value as Role;
                                  if (role !== member.role) setPendingRole({ member, role });
                                }}
                              >
                                {ROLES.map((role) => (
                                  <option key={role} value={role}>
                                    {ROLE_LABELS[role]}
                                  </option>
                                ))}
                              </Select>
                            </>
                          ) : (
                            <Badge tone={member.role === 'OWNER' ? 'accent' : 'plain'}>{ROLE_LABELS[member.role]}</Badge>
                          )}
                        </td>
                        <td className="table__num">{member.grantCount}</td>
                        <td className="table__num">{member.openTaskCount}</td>
                        <td className="small">{formatIsoDate(member.joinedAt.slice(0, 10))}</td>
                        {canManage && (
                          <td>
                            {!isDemo && !lockedByOwner && (
                              <div className="row" style={{ justifyContent: 'flex-end' }}>
                                <button type="button" className="btn btn--sm btn--ghost" onClick={() => resetLink.mutate(member.userId)} disabled={resetLink.isPending} title="Create a one-hour password reset link">
                                  <KeyRound size={14} aria-hidden="true" />
                                  Reset link
                                </button>
                                {!isSelf && (
                                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => setRemoving(member)}>
                                    <UserMinus size={14} aria-hidden="true" />
                                    Remove
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!canManage && (
              <div className="card__footer">
                <p className="small muted">Only owners and managers can change roles or invite people. An owner’s role can only be changed by another owner.</p>
              </div>
            )}
          </Card>
        )}

        <Card title="What each role can do" subtitle="The same table the server checks on every request.">
          <div className="table-wrap">
            <table className="table table--compact">
              <caption className="visually-hidden">Permission matrix by role</caption>
              <thead>
                <tr>
                  <th scope="col">Permission</th>
                  {ROLES.map((role) => (
                    <th key={role} scope="col" style={{ textAlign: 'center' }}>
                      {ROLE_LABELS[role]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CAPABILITIES.map((capability) => (
                  <tr key={capability}>
                    <th scope="row" style={{ fontWeight: 500, textAlign: 'left' }}>
                      {CAPABILITY_LABELS[capability] ?? capability}
                    </th>
                    {ROLES.map((role) => {
                      const allowed = ROLE_CAPABILITIES[role].includes(capability);
                      return (
                        <td key={role} style={{ textAlign: 'center' }}>
                          <span aria-hidden="true">{allowed ? '●' : '—'}</span>
                          <span className="visually-hidden">{allowed ? 'Allowed' : 'Not allowed'}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="stack stack-2" style={{ marginTop: 'var(--space-5)', listStyle: 'none' }}>
            {ROLES.map((role) => (
              <li key={role} className="small">
                <strong>{ROLE_LABELS[role]}:</strong> <span className="muted">{ROLE_DESCRIPTIONS[role]}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <ConfirmDialog
        open={pendingRole !== null}
        title="Change this person’s role?"
        description={
          pendingRole
            ? `${pendingRole.member.name} moves from ${ROLE_LABELS[pendingRole.member.role]} to ${ROLE_LABELS[pendingRole.role]}. Their access changes immediately${
                pendingRole.role === 'OWNER' ? ', and owners have full control of this workspace, including team and settings' : ''
              }. The change is recorded in the activity trail.`
            : ''
        }
        confirmLabel="Change role"
        busy={changeRole.isPending}
        onConfirm={() => {
          if (pendingRole) {
            changeRole.mutate({ userId: pendingRole.member.userId, role: pendingRole.role }, { onSettled: () => setPendingRole(null) });
          }
        }}
        onCancel={() => setPendingRole(null)}
      />

      <ConfirmDialog
        open={removing !== null}
        title="Remove this person?"
        description={
          removing
            ? `${removing.name} loses access to ${session.organization.name} immediately. Grants they own and tasks assigned to them stay, unassigned. Their notes and uploads remain in the record.`
            : ''
        }
        confirmLabel="Remove"
        tone="danger"
        busy={removeMember.isPending}
        onConfirm={() => {
          if (removing) removeMember.mutate(removing.userId, { onSettled: () => setRemoving(null) });
        }}
        onCancel={() => setRemoving(null)}
      />

      <Dialog open={linkDialog !== null} onClose={() => setLinkDialog(null)} title={linkDialog?.title ?? ''} description={linkDialog?.description}>
        {linkDialog && (
          <div className="stack stack-3">
            <div className="copy-row">
              <Input readOnly value={linkDialog.url} aria-label="Link" onFocus={(e) => e.currentTarget.select()} />
              <button
                type="button"
                className="btn btn--primary"
                onClick={async () => {
                  toast.push((await copyText(linkDialog.url)) ? 'Copied.' : 'Select the link and copy it.', 'info');
                }}
              >
                <Copy size={16} aria-hidden="true" />
                Copy
              </button>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              <UserPlus size={13} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> Links are stored only as hashes; if you lose this one, create a new one.
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}
