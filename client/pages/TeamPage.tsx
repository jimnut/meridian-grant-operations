import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { BRAND } from '../../shared/brand';
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from '../../shared/constants';
import { CAPABILITIES, ROLE_CAPABILITIES } from '../../shared/permissions';
import { formatIsoDate } from '../../shared/dates';
import type { TeamMember } from '../../shared/types';
import { api, ApiRequestError } from '../lib/api';
import { useCurrentSession, useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import { ConfirmDialog } from '../components/Dialog';
import { Avatar, Badge, Card, ErrorState, LoadingState, Select } from '../components/ui';

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
  'team:manage': 'Manage team roles',
  'org:manage': 'Change organization settings',
  'export:run': 'Export data',
};

export function TeamPage() {
  const session = useCurrentSession();
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    document.title = `Team · ${BRAND.titleSuffix}`;
  }, []);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['team'],
    queryFn: () => api.get<TeamMember[]>('/team'),
  });

  // A role decides what a person can see and do, so the select stages the
  // change and a dialog asks for explicit confirmation before applying it.
  const [pendingRole, setPendingRole] = useState<{ member: TeamMember; role: Role } | null>(null);

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) => api.patch(`/team/${userId}/role`, { role }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['team'] });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      toast.success('Role updated.');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiRequestError ? error.message : 'That role could not be changed.'),
  });

  const canManage = can('team:manage');

  return (
    <>
      <header className="page-header">
        <div className="page-header__text">
          <p className="page-header__eyebrow">{session.organization.name}</p>
          <h1 className="page-header__title">Team</h1>
          <p className="page-header__lede">
            Roles decide what each person can change. Permissions are enforced on the server, so a role change takes
            effect everywhere immediately.
          </p>
        </div>
      </header>

      <div className="stack stack-5">
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!canManage && (
              <div className="card__footer">
                <p className="small muted">Only owners and managers can change roles. An owner’s role can only be changed by another owner.</p>
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
            ? `${pendingRole.member.name} moves from ${ROLE_LABELS[pendingRole.member.role]} to ${
                ROLE_LABELS[pendingRole.role]
              }. Their access changes immediately${
                pendingRole.role === 'OWNER'
                  ? ', and owners have full control of this workspace, including team and settings'
                  : ''
              }. The change is recorded in the activity trail.`
            : ''
        }
        confirmLabel="Change role"
        busy={changeRole.isPending}
        onConfirm={() => {
          if (pendingRole) {
            changeRole.mutate(
              { userId: pendingRole.member.userId, role: pendingRole.role },
              { onSettled: () => setPendingRole(null) },
            );
          }
        }}
        onCancel={() => setPendingRole(null)}
      />
    </>
  );
}
