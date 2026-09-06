import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, CheckCircle2, Circle, FileSpreadsheet, Sparkles, X } from 'lucide-react';

import type { OnboardingStatus } from '../../shared/types';
import { trackEvent } from '../lib/analytics';
import { api, ApiRequestError } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import { Card } from './ui';

/**
 * A short, honest checklist for a new workspace. Disappears once dismissed or
 * once the portfolio is clearly real (several grants and no sample data).
 */
export function OnboardingCard() {
  const { session, can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['onboarding'], queryFn: () => api.get<OnboardingStatus>('/onboarding'), staleTime: 15_000 });

  const refreshAll = async () => {
    await queryClient.invalidateQueries();
  };

  const loadSample = useMutation({
    mutationFn: () => api.post('/onboarding/sample-data'),
    onSuccess: async () => {
      trackEvent('sample_data_loaded');
      await refreshAll();
      toast.success('Sample portfolio loaded. Every dashboard signal now has something to say.');
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : 'Could not load the sample portfolio.'),
  });
  const removeSample = useMutation({
    mutationFn: () => api.delete('/onboarding/sample-data'),
    onSuccess: async () => {
      await refreshAll();
      toast.success('Sample data removed.');
    },
    onError: (error: unknown) => toast.error(error instanceof ApiRequestError ? error.message : 'Could not remove the sample data.'),
  });
  const dismiss = useMutation({
    mutationFn: () => api.post('/onboarding/dismiss'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['onboarding'] });
    },
  });

  if (!session || session.workspace.isDemo || !data || data.dismissed) return null;
  const realGrants = data.grants - (data.hasSampleData ? 3 : 0);
  if (realGrants >= 5 && !data.hasSampleData) return null;

  const items: Array<{ key: string; label: string; done: boolean; to: string }> = [
    { key: 'funder', label: 'Add a funder', done: data.funders > (data.hasSampleData ? 2 : 0), to: '/funders' },
    { key: 'grant', label: 'Add your first grant (or import your spreadsheet)', done: realGrants > 0, to: '/grants' },
    { key: 'deliverable', label: 'Add each funder report as a deliverable with a due date', done: data.milestones > 0 && realGrants > 0, to: '/grants' },
    { key: 'evidence', label: 'Attach a piece of evidence to a deliverable', done: data.documents > 0, to: '/grants' },
    { key: 'team', label: 'Invite a teammate or your finance lead', done: data.members > 1, to: '/team' },
    { key: 'calendar', label: 'Subscribe your calendar to the deadline feed', done: data.calendarConnected, to: '/settings/calendar' },
  ];
  const doneCount = items.filter((item) => item.done).length;
  const canWrite = can('grants:write');

  return (
    <Card
      title="Set up your workspace"
      subtitle={`${doneCount} of ${items.length} done · your trial has ${session.workspace.trialDaysLeft ?? '—'} days left`}
      actions={
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => dismiss.mutate()} aria-label="Dismiss setup checklist">
          <X size={16} aria-hidden="true" />
          Dismiss
        </button>
      }
    >
      <div className="grid grid--main-side">
        <ul className="onboarding__list">
          {items.map((item) => (
            <li key={item.key} className={`onboarding__item${item.done ? ' onboarding__item--done' : ''}`}>
              {item.done ? <CheckCircle2 size={18} color="var(--positive)" aria-hidden="true" /> : <Circle size={18} color="var(--ink-300)" aria-hidden="true" />}
              <Link to={item.to} style={{ flex: 1 }}>
                {item.label}
              </Link>
              <span className="visually-hidden">{item.done ? 'Done' : 'Not done'}</span>
            </li>
          ))}
        </ul>
        <div className="stack stack-3">
          {canWrite && (
            <Link to="/grants/import" className="btn">
              <FileSpreadsheet size={16} aria-hidden="true" />
              Import a spreadsheet
            </Link>
          )}
          {canWrite && !data.hasSampleData && realGrants === 0 && (
            <button type="button" className="btn" onClick={() => loadSample.mutate()} disabled={loadSample.isPending}>
              <Sparkles size={16} aria-hidden="true" />
              {loadSample.isPending ? 'Loading…' : 'Load a sample portfolio'}
            </button>
          )}
          {data.hasSampleData && can('grants:archive') && (
            <button type="button" className="btn btn--ghost" onClick={() => removeSample.mutate()} disabled={removeSample.isPending}>
              {removeSample.isPending ? 'Removing…' : 'Remove sample data'}
            </button>
          )}
          <Link to="/settings/calendar" className="btn btn--ghost">
            <CalendarPlus size={16} aria-hidden="true" />
            Calendar feed
          </Link>
          <p className="muted small" style={{ margin: 0 }}>
            Stuck? Reply to your welcome email or write to support@grantconsole.com — a person answers within a business day.
          </p>
        </div>
      </div>
    </Card>
  );
}
