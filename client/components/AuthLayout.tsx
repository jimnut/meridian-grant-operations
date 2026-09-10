import { useEffect, type ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, Check, FileCheck2, ShieldCheck, Wallet } from 'lucide-react';

import { BRAND } from '../../shared/brand';
import { BrandMark } from './BrandMark';
import '../styles/auth.css';

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
    <div className="signin signin--refreshed">
      <section className="signin__brandside">
        <a className="signin__brand" href="/" aria-label={`${BRAND.name} home`}>
          <BrandMark />
          <span className="signin__wordmark">{BRAND.name}<span className="signin__brand-dot">.</span></span>
        </a>

        <div className="signin__story">
          <p className="signin__eyebrow"><span aria-hidden="true" /> A clearer view of what’s next</p>
          <h1 className="signin__headline">{headline}</h1>
          <p className="signin__lede">{lede}</p>

          <div className="signin__preview" role="img" aria-label="Illustrative workflow: review grant obligations, track restricted budgets, and keep supporting evidence together.">
            <div className="signin__preview-top" aria-hidden="true">
              <span className="signin__preview-label">Your grant workspace</span>
              <span className="signin__preview-caption">Illustrative view</span>
            </div>
            <div className="signin__preview-title" aria-hidden="true">
              <span>Everything in its place.</span>
              <ArrowUpRight size={20} />
            </div>
            <div className="signin__preview-rows" aria-hidden="true">
              <div className="signin__preview-row">
                <span className="signin__preview-icon"><FileCheck2 size={18} /></span>
                <span><strong>Grant obligations</strong><small>Know the next deadline</small></span>
                <span className="signin__preview-check"><Check size={14} /></span>
              </div>
              <div className="signin__preview-row">
                <span className="signin__preview-icon"><Wallet size={18} /></span>
                <span><strong>Restricted budgets</strong><small>Keep every dollar in view</small></span>
                <span className="signin__preview-track"><span /></span>
              </div>
              <div className="signin__preview-row">
                <span className="signin__preview-icon"><ShieldCheck size={18} /></span>
                <span><strong>Supporting evidence</strong><small>Connected to the right records</small></span>
                <span className="signin__preview-check"><Check size={14} /></span>
              </div>
            </div>
          </div>

          <ul className="signin__points">
            <li className="signin__point">
              <Check size={15} aria-hidden="true" />
              <span>Clear risk signals</span>
            </li>
            <li className="signin__point">
              <Check size={15} aria-hidden="true" />
              <span>Connected records</span>
            </li>
            <li className="signin__point">
              <Check size={15} aria-hidden="true" />
              <span>Shared ownership</span>
            </li>
          </ul>
        </div>

        <p className="signin__footnote">
          {footnote ?? 'Built for grant recipients, not grantmakers. No card needed for the trial.'}
        </p>
      </section>

      <main className="signin__formside">
        <a href="/" className="signin__back"><ArrowLeft size={14} aria-hidden="true" /> Back to home</a>
        <div className="signin__card">{children}</div>
        <footer className="signin__legal">
          <a href="/privacy">Privacy</a><span aria-hidden="true">·</span><a href="/terms">Terms</a><span aria-hidden="true">·</span><a href="/contact">Get in touch</a>
        </footer>
      </main>
    </div>
  );
}
