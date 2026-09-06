import { useEffect, type ReactNode } from 'react';
import { Landmark, ShieldCheck, Wallet } from 'lucide-react';

import { BRAND } from '../../shared/brand';

/** The split sign-in layout, shared by sign-up, invitations and password flows. */
export function AuthLayout({
  title,
  headline,
  lede,
  footnote,
  children,
}: {
  title: string;
  headline: string;
  lede: string;
  footnote?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} · ${BRAND.titleSuffix}`;
  }, [title]);

  return (
    <div className="signin">
      <section className="signin__brandside">
        <div className="signin__brand">
          <span className="brandmark" aria-hidden="true">
            {BRAND.monogram}
          </span>
          <span className="sidebar__wordmark">
            <span className="sidebar__name">{BRAND.name}</span>
            <span className="sidebar__descriptor">{BRAND.descriptor}</span>
          </span>
        </div>

        <div>
          <h1 className="signin__headline">{headline}</h1>
          <p className="signin__lede">{lede}</p>
          <ul className="signin__points">
            <li className="signin__point">
              <ShieldCheck size={18} aria-hidden="true" />
              <span>Explainable risk signals — every flag states the reason and the evidence behind it.</span>
            </li>
            <li className="signin__point">
              <Wallet size={18} aria-hidden="true" />
              <span>Restricted budgets tracked to the cent, with burn measured against the grant period.</span>
            </li>
            <li className="signin__point">
              <Landmark size={18} aria-hidden="true" />
              <span>Audit-ready reporting packets assembled from the records your team already keeps.</span>
            </li>
          </ul>
        </div>

        <p className="signin__footnote small" style={{ color: 'var(--nav-text-dim)' }}>
          {footnote ?? 'Built for grant recipients, not grantmakers. No card needed for the trial.'}
        </p>
      </section>

      <section className="signin__formside">
        <div className="signin__card">{children}</div>
      </section>
    </div>
  );
}
