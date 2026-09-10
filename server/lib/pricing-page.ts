/**
 * The public pricing page. Rendered from shared/plans.ts so the numbers on the
 * page, in the app and in Stripe metadata can never disagree. Dependency-free
 * HTML with the shared public chrome; the FAQ is visible and mirrored exactly
 * in FAQPage structured data.
 */

import { config } from '../config';
import { annualSavingsPercent, formatUsd, FOUNDING_OFFER, PLAN_IDS, PLANS, TRIAL_DAYS, type PlanDefinition } from '../../shared/plans';
import { entityGraphNodes, escapeHtml, injectAnalytics, publicFooter, publicHead, publicHeader } from './public-chrome';

export const PRICING_FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'How does the free trial work?',
    a: `Every new workspace starts with a ${TRIAL_DAYS}-day trial of every feature at Growth-plan limits. No card is needed and nobody calls you. When the trial ends the workspace becomes read-only until you choose a plan: nothing is deleted, and exports keep working.`,
  },
  {
    q: 'What counts as an active grant?',
    a: 'Any grant that is not closed, declined or archived: prospects you are tracking, applications in flight, and every awarded grant with live obligations. Closed and declined grants stay in your history and never count.',
  },
  {
    q: 'Is there a nonprofit discount?',
    a: 'GrantConsole is only sold to nonprofits, so the list price is the nonprofit price. Paying annually saves roughly two months on every plan, and we are glad to work with fiscal-year budget timing.',
  },
  {
    q: 'Can we pay by invoice or ACH instead of a card?',
    a: 'Contact support@grantconsole.com with your organization name, preferred plan and purchasing requirements. We will confirm the available invoicing, payment and vendor-documentation options before you commit.',
  },
  {
    q: 'What happens to our data if we cancel?',
    a: 'You can export every grant, deliverable, budget line and the evidence list to CSV at any time, and download every uploaded file. After cancellation the workspace stays read-only through the end of the paid period, and you can delete the organization yourself from Settings.',
  },
  {
    q: 'Do you charge per user?',
    a: 'No. Each plan includes a number of editor seats, and viewers — board members, auditors, funders, program staff who only need to look — are free and unlimited on every plan. Scale includes unlimited editor seats too.',
  },
  {
    q: 'Can one login belong to several organizations?',
    a: 'Yes. A fiscal sponsor, consultant or board member can hold a seat in several organizations and switch between them; records never mix. Each organization is billed on its own plan.',
  },
  {
    q: 'Is GrantConsole a grant-discovery or fundraising tool?',
    a: 'No. It begins after the award letter: deadlines, deliverables, restricted budgets, evidence and funder reports. Teams keep using their prospect database and donor CRM alongside it.',
  },
];

function planCard(plan: PlanDefinition): string {
  const savings = annualSavingsPercent(plan);
  const cta = `/signup?plan=${plan.id}`;
  return `<article class="plan${plan.recommended ? ' plan--featured' : ''}" aria-labelledby="plan-${plan.id}">
      ${plan.recommended ? '<p class="plan__flag">For growing portfolios</p>' : ''}
      <h2 id="plan-${plan.id}">${escapeHtml(plan.name)}</h2>
      <p class="plan__tagline">${escapeHtml(plan.tagline)}</p>
      <p class="plan__price"><span class="plan__amount">${formatUsd(plan.priceMonthlyUsd)}</span><span class="plan__per">/month</span></p>
      <p class="plan__annual">or ${formatUsd(plan.priceAnnualUsdPerMonth)}/month billed annually <span class="plan__save">save ${savings}%</span></p>
      <a class="button${plan.recommended ? '' : ' button--ghost'}" href="${cta}">Start free trial</a>
      <p class="plan__audience">${escapeHtml(plan.audience)}</p>
      <ul class="plan__features">
        ${plan.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('\n        ')}
      </ul>
    </article>`;
}

function limitCell(value: number | null, unit: string): string {
  return value === null ? 'Unlimited' : `${value} ${unit}`;
}

export function pricingHtml(): string {
  const canonical = `${config.siteUrl}/pricing`;
  const title = 'GrantConsole Pricing — Post-Award Grant Management for Nonprofits';
  const description = `Plans from ${formatUsd(PLANS.starter.priceAnnualUsdPerMonth)}/month for nonprofit grant teams. Every plan starts with a ${TRIAL_DAYS}-day free trial of all features — no card, no sales call.`;
  const plans = PLAN_IDS.map((id) => PLANS[id]);

  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      ...entityGraphNodes(),
      {
        '@type': 'WebPage',
        '@id': `${canonical}#webpage`,
        name: title,
        description,
        url: canonical,
        isPartOf: { '@id': `${config.siteUrl}/#website` },
        about: { '@id': `${config.siteUrl}/#software` },
        inLanguage: 'en-US',
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${config.siteUrl}/#software`,
        name: 'GrantConsole',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: `${config.siteUrl}/`,
        description:
          'Post-award grant management software for nonprofit teams: deadline and compliance tracking, restricted budget monitoring, evidence collection and funder reporting.',
        offers: plans.map((plan) => ({
          '@type': 'Offer',
          name: `${plan.name} plan`,
          description: plan.tagline,
          url: `${config.siteUrl}/signup?plan=${plan.id}`,
          price: String(plan.priceAnnualUsdPerMonth),
          priceCurrency: 'USD',
          category: 'subscription',
          priceSpecification: [
            {
              '@type': 'UnitPriceSpecification',
              name: 'Billed annually',
              price: String(plan.priceAnnualUsdPerMonth),
              priceCurrency: 'USD',
              billingDuration: 1,
              unitCode: 'MON',
            },
            {
              '@type': 'UnitPriceSpecification',
              name: 'Billed monthly',
              price: String(plan.priceMonthlyUsd),
              priceCurrency: 'USD',
              billingDuration: 1,
              unitCode: 'MON',
            },
          ],
          availability: 'https://schema.org/InStock',
        })),
      },
      {
        '@type': 'FAQPage',
        '@id': `${canonical}#faq`,
        url: `${canonical}#faq`,
        isPartOf: { '@id': `${canonical}#webpage` },
        mainEntity: PRICING_FAQ.map((entry) => ({
          '@type': 'Question',
          name: entry.q,
          acceptedAnswer: { '@type': 'Answer', text: entry.a },
        })),
      },
    ],
  });

  const styles = `
    .pricing-hero { max-width:820px; padding-bottom:20px; border-bottom:0; }
    .plans { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:18px; margin:44px 0 22px; align-items:stretch; }
    .plan { position:relative; display:flex; flex-direction:column; gap:12px; padding:34px 28px 30px; background:var(--card); border:1px solid var(--edge); border-radius:20px; }
    .plan--featured { border-color:var(--signal); background:var(--signal-soft); box-shadow:0 12px 32px rgba(47,111,43,.06); }
    .plan__flag { position:absolute; top:-15px; left:24px; margin:0; padding:6px 12px; background:var(--lime); color:var(--ink); border:1px solid #c5e9a0; border-radius:7px; font:600 11px/1.4 var(--sans); letter-spacing:.035em; }
    .plan h2 { margin:0; font-size:24px; font-weight:600; letter-spacing:-.04em; }
    .plan__tagline { margin:0; min-height:48px; color:var(--muted); font-size:15px; line-height:1.55; }
    .plan__price { margin:12px 0 0; display:flex; align-items:baseline; gap:6px; }
    .plan__amount { font-family:var(--sans); font-size:52px; font-weight:550; letter-spacing:-.065em; line-height:1; }
    .plan__per { color:var(--muted); font-size:15px; }
    .plan__annual { margin:0 0 8px; color:var(--muted); font-size:13.5px; }
    .plan__save { display:inline-block; margin-left:4px; padding:2px 7px; background:var(--signal-soft); color:var(--signal-deep); border-radius:5px; font:600 11px/1.5 var(--sans); }
    .plan--featured .plan__save { background:#d9edcf; }
    .plan .button { justify-self:stretch; text-align:center; margin-top:2px; font-size:14px; }
    .button--ghost { background:var(--card); color:var(--ink); border:1px solid var(--edge); }
    .button--ghost:hover { background:var(--signal-soft); border-color:#b8cfb1; }
    .plan__audience { margin:8px 0 0; padding-top:18px; border-top:1px solid var(--edge); font:600 13px/1.5 var(--sans); color:var(--signal-deep); }
    .plan__features { margin:4px 0 0; padding:0; list-style:none; display:grid; gap:8px; }
    .plan__features li { position:relative; padding-left:22px; font-size:14.5px; line-height:1.5; }
    .plan__features li::before { content:'✓'; position:absolute; left:0; top:0; color:var(--signal); font-size:14px; font-weight:700; }
    .trial-note { max-width:86ch; margin:14px auto 0; text-align:center; color:var(--muted); font-size:13px; line-height:1.65; }
    .included { margin:64px 0 0; padding:36px; background:var(--card); border:1px solid var(--edge); border-radius:20px; }
    .included h2 { margin:0 0 6px; font-size:24px; letter-spacing:-.02em; }
    .included ul { margin:14px 0 0; padding:0; list-style:none; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px 24px; }
    .included li { position:relative; padding-left:22px; font-size:15px; }
    .included li::before { content:'✓'; position:absolute; left:0; top:0; color:var(--signal-deep); font-weight:800; }
    .compare { margin:52px 0 0; }
    .compare h2 { margin:0 0 14px; font-size:26px; letter-spacing:-.02em; }
    .compare-wrap { overflow-x:auto; border:1px solid var(--edge); border-radius:14px; background:var(--card); }
    .compare table { width:100%; border-collapse:collapse; font-size:14.5px; min-width:540px; }
    .compare th,.compare td { padding:13px 16px; text-align:left; border-bottom:1px solid var(--edge); }
    .compare thead th { background:var(--signal-soft); font:600 14px/1.4 var(--sans); }
    .compare tbody tr:last-child td,.compare tbody tr:last-child th { border-bottom:0; }
    .compare th[scope=row] { font-weight:600; }
    .lead { margin:64px 0 0; display:grid; grid-template-columns:1.1fr 1fr; gap:48px; padding:42px; background:var(--night); color:#f7f8f5; border-radius:24px; }
    .lead h2 { margin:0 0 14px; font-size:32px; font-weight:550; line-height:1.15; letter-spacing:-.04em; color:#fff; }
    .lead p { margin:0; color:#b5c0b4; font-size:15px; line-height:1.7; }
    .lead a { color:var(--lime); }
    .lead :focus-visible { outline-color:var(--lime); }
    .lead-form { display:grid; gap:12px; }
    .lead-form label { display:grid; gap:7px; font:500 13px/1.4 var(--sans); color:#b5c0b4; }
    .lead-form input,.lead-form textarea { width:100%; padding:12px 14px; border:1px solid #3d4b3e; border-radius:9px; background:var(--night-soft); color:#fff; font:15px/1.4 var(--sans); }
    .lead-form input::placeholder,.lead-form textarea::placeholder { color:#a7b4a6; opacity:1; }
    .lead-form textarea { min-height:88px; resize:vertical; }
    .lead-form button { padding:14px 18px; background:var(--lime); color:var(--ink); border:0; border-radius:9px; font:600 15px var(--sans); cursor:pointer; }
    .lead-form button:hover { background:#c8ef67; }
    .lead-form .hp { position:absolute; left:-9999px; width:1px; height:1px; overflow:hidden; }
    .faq { max-width:820px; margin:64px auto 0; }
    .faq h2 { margin:0 0 10px; font-size:26px; letter-spacing:-.02em; }
    .faq details { padding:20px 0; border-bottom:1px solid var(--edge); }
    .faq summary { cursor:pointer; font-size:17px; font-weight:550; }
    .faq details p { margin:10px 0 0; max-width:70ch; color:var(--muted); }
    @media (max-width:950px) { .plan { padding-inline:20px; } .plan__amount { font-size:46px; } }
    @media (max-width:820px) { .plans { max-width:540px; margin-inline:auto; grid-template-columns:1fr; gap:26px; } .plan { padding:32px 26px; } .plan__tagline { min-height:0; } .included { padding:26px; } .included ul { grid-template-columns:1fr; } .lead { grid-template-columns:1fr; padding:28px; gap:28px; } .lead h2 { font-size:28px; } }
  `;

  const html = `<!doctype html>
<html lang="en">
${publicHead({ title, description, canonical, structuredData }, styles)}
<body>
  ${publicHeader()}
  <main class="page-shell">
    <header class="page-hero pricing-hero">
      <p class="eyebrow">Pricing</p>
      <h1>Priced for teams that answer to funders.</h1>
      <p class="intro">Every workspace starts with a ${TRIAL_DAYS}-day free trial of every feature — no card, no sales call. Choose a plan when the portfolio is in and the first report is out the door. Cancel any time.</p>
    </header>

    <section aria-label="Plans">
      <div class="plans">
        ${plans.map(planCard).join('\n        ')}
      </div>
      <p class="trial-note">Prices in US dollars; annual billing saves about two months. Contact us to confirm invoice and payment options. Trials run at Growth-plan limits so a real portfolio fits.</p>
      <p class="trial-note"><strong>Founding-customer offer:</strong> the first ${FOUNDING_OFFER.organizations} organizations to subscribe lock in ${FOUNDING_OFFER.percentOff}% off for their first year, applied automatically at checkout. Paying by invoice? Mention it when you get in touch.</p>
    </section>

    <section class="included" aria-labelledby="included-heading">
      <h2 id="included-heading">The core grant workflow is in every plan.</h2>
      <p style="margin:0;color:var(--muted)">Compare grant limits, editor seats, storage and the support included with each plan.</p>
      <ul>
        <li>Deadlines, deliverables, tasks and a subscribable calendar feed</li>
        <li>Restricted budgets tracked to the cent against the grant period</li>
        <li>Evidence attached to the deliverable that requires it</li>
        <li>Eleven explainable risk rules that state why a grant needs attention</li>
        <li>Funder reporting packets and CSV exports</li>
        <li>Owner, manager, member and viewer roles with an activity trail</li>
        <li>Spreadsheet import with a ready-made template</li>
        <li>Support from the people who build the product</li>
      </ul>
    </section>

    <section class="compare" aria-labelledby="compare-heading">
      <h2 id="compare-heading">Compare limits</h2>
      <div class="compare-wrap">
        <table>
          <thead>
            <tr><th scope="col">Limit</th>${plans.map((plan) => `<th scope="col">${escapeHtml(plan.name)}</th>`).join('')}</tr>
          </thead>
          <tbody>
            <tr><th scope="row">Active grants</th>${plans.map((plan) => `<td>${limitCell(plan.limits.activeGrants, 'grants')}</td>`).join('')}</tr>
            <tr><th scope="row">Editor seats</th>${plans.map((plan) => `<td>${limitCell(plan.limits.members, 'seats')}</td>`).join('')}</tr>
            <tr><th scope="row">Viewer seats</th>${plans.map(() => '<td>Unlimited, free</td>').join('')}</tr>
            <tr><th scope="row">Evidence storage</th>${plans.map((plan) => `<td>${Math.round(plan.limits.storageMb / 1024)} GB</td>`).join('')}</tr>
            <tr><th scope="row">Monthly price</th>${plans.map((plan) => `<td>${formatUsd(plan.priceMonthlyUsd)}/mo</td>`).join('')}</tr>
            <tr><th scope="row">Annual price</th>${plans.map((plan) => `<td>${formatUsd(plan.priceAnnualUsdPerMonth * 12)}/yr (${formatUsd(plan.priceAnnualUsdPerMonth)}/mo)</td>`).join('')}</tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="lead" aria-labelledby="lead-heading">
      <div>
        <h2 id="lead-heading">Prefer an invoice, or want a walkthrough first?</h2>
        <p>Tell us how many grants you manage and what your team needs. We can discuss the product, spreadsheet imports and your purchasing requirements. Please use example data for an initial walkthrough.</p>
        <p style="margin-top:14px">Or skip the form: <a href="mailto:${config.supportEmail}?subject=GrantConsole%20plan">${config.supportEmail}</a></p>
      </div>
      <form class="lead-form" method="post" action="/api/public/leads">
        <input type="hidden" name="source" value="pricing" />
        <label class="hp" aria-hidden="true">Website<input type="text" name="website" tabindex="-1" autocomplete="off" /></label>
        <label>Work email<input type="email" name="email" required autocomplete="email" /></label>
        <label>Your name<input type="text" name="name" autocomplete="name" /></label>
        <label>Organization<input type="text" name="organization" autocomplete="organization" /></label>
        <label>What would help?<textarea name="message" placeholder="e.g. We manage 22 grants, 6 of them federal. We would like an annual invoice for Growth."></textarea></label>
        <button type="submit">Send</button>
      </form>
    </section>

    <section class="faq" id="faq" aria-labelledby="faq-heading">
      <h2 id="faq-heading">Pricing questions</h2>
      ${PRICING_FAQ.map((entry) => `<details><summary>${escapeHtml(entry.q)}</summary><p>${escapeHtml(entry.a)}</p></details>`).join('\n      ')}
    </section>
  </main>
  ${publicFooter()}
</body>
</html>`;
  return injectAnalytics(html);
}
