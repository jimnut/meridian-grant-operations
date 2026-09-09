import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, CalendarPlus, CheckCircle2, Circle, FileSpreadsheet, Sparkles, X } from 'lucide-react';

import type { OnboardingStatus } from '../../shared/types';
import { trackEvent } from '../lib/analytics';
import { api, ApiRequestError } from '../lib/api';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import { Card, Progress } from './ui';

/** A role-aware path to a real portfolio, separate from exploring sample data. */
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
    onError: () => toast.error('Could not dismiss setup. Please try again.'),
  });

  if (!session || session.workspace.isDemo || session.workspace.readOnly || !can('grants:write') || !data || data.dismissed) return null;
  if (data.grants >= 5 && !data.hasSampleData) return null;

  const items = [
    {
      key: 'grant', label: 'Add your first grant', done: data.grants > 0, to: '/grants/import', action: 'Import your spreadsheet',
      description: 'Bring in your grant titles, funders, award amounts and reporting dates. Preview the mapping before anything is imported.',
    },
    {
      key: 'funder', label: 'Add a funder', done: data.funders > 0, to: '/funders', action: 'Add a funder',
      description: 'Create the funder record so your award has a clear funding source and a place for its contacts.',
    },
    {
      key: 'deliverable', label: 'Add your first deliverable', done: data.milestones > 0, to: '/grants', action: 'Open a grant',
      description: 'Open an award, choose Deliverables, and add the next funder report with its due date and owner.',
    },
    {
      key: 'evidence', label: 'Upload your first evidence file', done: data.documents > 0, to: '/grants', action: 'Open a grant',
      description: 'Open an award’s Evidence tab, upload a supporting file and link it to the deliverable it supports.',
    },
    ...(can('team:manage') ? [
      {
        key: 'team', label: 'Invite a teammate', done: data.members > 1, to: '/team', action: 'Invite your team',
        description: 'Bring your grants or finance lead into the workspace and choose the access they need.',
      },
      {
        key: 'calendar', label: 'Create the shared calendar feed', done: data.calendarConnected, to: '/settings/calendar', action: 'Set up the calendar feed',
        description: 'Create a calendar link, then subscribe to it in your calendar app to see the team’s grant deadlines.',
      },
    ] : []),
  ];
  const doneCount = items.filter((item) => item.done).length;
  const next = items.find((item) => !item.done);
  const trialLabel = session.workspace.status === 'trialing' && session.workspace.trialDaysLeft !== null
    ? `${session.workspace.trialDaysLeft} ${session.workspace.trialDaysLeft === 1 ? 'day' : 'days'} left in your trial`
    : session.workspace.statusLabel;

  return (
    <div className="dashboard-onboarding">
      <Card
        id="workspace-setup-heading"
        title="Set up your workspace"
        subtitle={data.hasSampleData ? `Exploring sample data · ${trialLabel}` : `${doneCount} of ${items.length} steps complete · ${trialLabel}`}
        actions={
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => dismiss.mutate()} disabled={dismiss.isPending} aria-label="Dismiss setup checklist">
            <X size={16} aria-hidden="true" />
            Dismiss
          </button>
        }
      >
        <div className="dashboard-setup">
          <div className="dashboard-setup__focus">
            <p className="dashboard-kicker">{data.hasSampleData ? 'Explore the workflow' : next ? 'Your next step' : 'Ready for your first review'}</p>
            <h3>{data.hasSampleData ? 'Follow a sample award from risk to report.' : next?.label ?? 'Review your portfolio together.'}</h3>
            <p>
              {data.hasSampleData
                ? 'The dashboard includes sample records. Explore their deadlines, budgets and evidence; remove the samples when you are ready to assess your own grants.'
                : next?.description ?? 'Your setup checklist is complete. Open the portfolio to review the deadlines, owners and evidence behind each grant.'}
            </p>
            <Link to={data.hasSampleData ? '/grants' : next?.to ?? '/grants'} className="btn btn--primary">
              {data.hasSampleData ? 'Explore sample grants' : next?.action ?? 'Review the portfolio'}
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
            {!data.hasSampleData && data.grants === 0 && <Link to="/grants" className="dashboard-setup__alternative">Or add a grant manually →</Link>}
          </div>

          {data.hasSampleData ? (
            <div className="dashboard-setup__samples">
              <h3>Ready to bring in your awards?</h3>
              <p>Import your spreadsheet with a preview of each column. Imported grants stay in place when you remove sample data.</p>
              <Link to="/grants/import" className="btn"><FileSpreadsheet size={16} aria-hidden="true" />Import a spreadsheet</Link>
              {can('grants:archive') && (
                <button type="button" className="btn btn--ghost" onClick={() => removeSample.mutate()} disabled={removeSample.isPending}>
                  {removeSample.isPending ? 'Removing…' : 'Remove sample data'}
                </button>
              )}
              <p className="small muted">Setup progress is shown after samples are removed, so sample records do not count as your completed setup.</p>
            </div>
          ) : (
            <div className="dashboard-setup__checklist">
              <Progress value={(doneCount / items.length) * 100} label="Workspace setup progress" />
              <ol className="onboarding__list">
                {items.map((item) => (
                  <li key={item.key} className={`onboarding__item${item.done ? ' onboarding__item--done' : ''}${item.key === next?.key ? ' dashboard-setup__current' : ''}`}>
                    {item.done ? <CheckCircle2 size={18} color="var(--positive)" aria-hidden="true" /> : <Circle size={18} color="var(--ink-300)" aria-hidden="true" />}
                    <Link to={item.done && item.key === 'grant' ? '/grants' : item.to}>{item.label}</Link>
                    <span className={item.key === next?.key ? 'dashboard-setup__next-label' : 'visually-hidden'}>{item.done ? 'Done' : item.key === next?.key ? 'Next' : 'Not done'}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        <div className="dashboard-setup__footer">
          {!data.hasSampleData && data.grants === 0 && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => loadSample.mutate()} disabled={loadSample.isPending}>
              <Sparkles size={16} aria-hidden="true" />
              {loadSample.isPending ? 'Loading…' : 'Load a sample portfolio'}
            </button>
          )}
          {(can('team:manage') || data.calendarConnected) && (
            <Link to="/settings/calendar" className="btn btn--ghost btn--sm"><CalendarPlus size={16} aria-hidden="true" />Calendar feed</Link>
          )}
          <a href="mailto:support@grantconsole.com" className="dashboard-setup__help">Get help with setup →</a>
        </div>
      </Card>
    </div>
  );
}
