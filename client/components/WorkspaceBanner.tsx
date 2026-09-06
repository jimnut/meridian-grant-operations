import { Link } from 'react-router-dom';
import { CreditCard, Lock, TimerReset } from 'lucide-react';

import { useSession } from '../lib/session';

/** Trial countdown, read-only and payment warnings, shown under the top bar. */
export function WorkspaceBanner() {
  const { session, can } = useSession();
  if (!session) return null;
  const ws = session.workspace;
  if (ws.isDemo) return null;
  const canManage = can('org:manage');
  const action = canManage ? (
    <Link to="/settings/billing" className="btn btn--sm btn--primary">
      <CreditCard size={14} aria-hidden="true" />
      Choose a plan
    </Link>
  ) : null;

  if (ws.readOnly) {
    return (
      <div className="workspace-banner">
        <div className="banner banner--risk" role="alert">
          <Lock size={17} className="banner__icon" aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <strong>Read-only.</strong> {ws.readOnlyReason}
            {!canManage && ' Ask an owner to choose a plan.'}
          </div>
          {action}
        </div>
      </div>
    );
  }
  if (ws.status === 'past_due') {
    return (
      <div className="workspace-banner">
        <div className="banner banner--amber" role="alert">
          <CreditCard size={17} className="banner__icon" aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <strong>Payment past due.</strong> Update the card in Settings → Plan &amp; billing to keep editing.
          </div>
          {canManage && (
            <Link to="/settings/billing" className="btn btn--sm">
              Update payment
            </Link>
          )}
        </div>
      </div>
    );
  }
  if (ws.status === 'trialing' && ws.trialDaysLeft !== null && ws.trialDaysLeft <= 7) {
    return (
      <div className="workspace-banner">
        <div className="banner banner--amber" role="status">
          <TimerReset size={17} className="banner__icon" aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <strong>
              {ws.trialDaysLeft === 0 ? 'Your trial ends today.' : `${ws.trialDaysLeft} day${ws.trialDaysLeft === 1 ? '' : 's'} left in your trial.`}
            </strong>{' '}
            Afterwards the workspace becomes read-only until a plan is chosen; nothing is deleted.
          </div>
          {action}
        </div>
      </div>
    );
  }
  return null;
}
