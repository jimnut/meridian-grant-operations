# GrantConsole content guide

This file is the standing brief for everyone (and every automated job) that
publishes to `grantconsole.com/resources`. It encodes the AI Search Growth
Program (15 August 2026) and the Sprint 1 content pack. Read it fully before
writing. `npm test` enforces the mechanical rules in `server/lib/articles.ts`;
the editorial rules below are enforced by you.

## 1. Why we publish

GrantConsole is **post-award grant management software for nonprofit grant
recipients**. The site had one indexable page in August 2026 and no external
authority. Search engines and answer engines (Google AI Overviews/AI Mode,
ChatGPT Search, Perplexity, Gemini, Copilot) need a body of specific, sourced,
consistently-positioned pages before they can cite or recommend the product.

We run an **AI-first, not AI-only** program: everything that makes a page
useful to Google (crawlable HTML, one clear job per page, original examples,
primary sources, honest limits, strong internal links) is also what earns AI
citations. There is no shortcut. One good article per day, compounding.

Track four outcomes, not one vanity score: eligibility (indexed), citation
(a link in an answer), mention (the brand is named accurately), and business
result (demo opened, contact, pilot).

## 2. Audience and voice

- **Readers:** grants/development managers at small-to-midsize nonprofits
  juggling roughly 5–25 restricted grants in spreadsheets, finance leads
  tracking restricted spend, executive directors and board treasurers who need
  a defensible answer to "are we on top of our grants?"
- **Voice:** calm, exact, candid, operational. Finance-grade. Second person is
  fine ("your team"). No hype, no filler, no motivational openers.
- **Never** confuse grant *recipients* with *grantmakers*. We write for the
  organizations that receive money and must deliver, steward and report.
- **Never** describe GrantConsole as grant discovery, prospect research,
  fundraising CRM, donor management, AI grant writing or "AI grant finding".
- Preferred questions to answer: "What must happen before Friday?", "Which
  grant needs a decision?", "What evidence is still missing?", "Are restricted
  funds moving to plan?"

## 3. Verified product facts (the only product claims allowed)

Anything about GrantConsole must come from this list, from the live public
pages, or from the source code in this repository. If it is not verifiable in
one of those places, do not write it.

- GrantConsole is post-award grant management software for nonprofit grant
  recipients. It is not a fundraising CRM and not a grant-discovery database.
- Brand line: "Every grant obligation, accounted for." Category statement:
  "Post-award grant management software for nonprofit teams." Built for grant
  recipients, not grantmakers.
- Product mechanics: deadlines/deliverables/renewals and grant-period dates;
  restricted budgets with burn measured against the elapsed grant period (not
  the calendar); evidence attached to the deliverable that requires it;
  eleven explainable risk rules that state which obligation, date, record or
  owner triggered them; reporting packets and CSV exports; role-based access
  (owner, manager, member, viewer) enforced by the server; activity history.
- Money is stored and summed as integer cents. Deadlines resolve in the
  workspace's configured timezone.
- Publicly documented risk rules (from the landing page and
  `shared/analytics.ts`): deliverable past due; evidence gap inside the final
  14 days before a report; spending ahead of the elapsed grant period by more
  than 15 points; budget burn behind the elapsed period by more than 15
  points; closeout window inside 30 days with work still open; no internal
  owner assigned. Other rules cover overdue tasks, evidence gaps on reports due
  within 30 days, grant periods that ended with open deliverables, renewal
  windows (90 days) with nothing scheduled, and applications due within 14
  days. Every warning names the rule and shows the underlying records.
- A live, seeded public demo is available at `/signin` with no sign-up and no
  sales call. The demo contains two example organizations and eighteen grants.
- Support address: support@grantconsole.com. Public trust pages: `/about`,
  `/contact`, `/security`, `/privacy`, `/terms`.
- Security facts are limited to what `/security` states (bcrypt password
  hashing, throttled sign-in, signed HTTP-only cookies, CSRF and origin checks,
  server-enforced roles, validated uploads, restrictive security headers). No
  certification exists and none may be implied.

### Forbidden (no verified basis today)

- Pricing, plans, free tiers, trials, discounts, "affordable" as a claim about
  GrantConsole's price. If a reader asks, point to `/contact`.
- Customers, pilots, logos, testimonials, case studies, usage numbers,
  "trusted by", "teams love", awards, rankings, "leading", "#1", "best".
- Founder biographies, company legal name/location, team size, funding.
- Integrations (QuickBooks, Salesforce, etc.), APIs, imports/exports beyond CSV
  export and reporting packets, mobile apps, SSO/MFA.
- SOC 2, ISO 27001, HIPAA, GDPR "compliance", encryption-at-rest specifics,
  backup guarantees, uptime figures.
- Any statement that GrantConsole makes an organization compliant with 2 CFR
  200 or any funder requirement, or that using it satisfies an audit.
- Federal-grant suitability beyond "GrantConsole tracks the obligations you
  enter; it does not interpret the award for you."
- Legal, accounting or audit advice presented as advice. Every article carries
  the standard disclaimer automatically; do not contradict it in copy.

## 4. Page quality standard (every article)

1. **Direct answer first.** The `summary` front-matter field is a 1–3 sentence
   answer to the primary question and is rendered as the lead. The first body
   section must not restate it as filler.
2. **One job per page.** Say who the page is for and what it covers within the
   first 150 words. Do not create near-duplicates of an existing article; if a
   topic overlaps, link to the existing page and go deeper on the delta.
3. **Original, hard-to-summarize material.** Worked examples with numbers,
   decision tables, checklists with the reason each item exists, common
   failure modes, "what good looks like" descriptions, template structures.
   Prefer specifics ("30 calendar days after the reporting period") over
   generalities ("promptly").
4. **Primary sources beside claims.** Federal-grant claims cite the current
   eCFR section (2 CFR part 200) or Grants.gov and include the check date in
   `sources[].checked`. Foundation/private grant claims are framed as "typical
   agreements" or "the award letter controls" — never asserted as universal.
   Statistics need a named source and year; if you cannot verify a number, do
   not use it.
5. **Limits and alternatives.** Every article says what it does not cover and
   when a reader needs a professional (auditor, grants attorney, CPA) or a
   different kind of tool.
6. **Structure.** Title (front matter) is the H1; body uses `##` sections and
   `###` subsections; 900–2,200 words for guides, 600–1,400 for checklists and
   templates, up to 3,000 for comparisons. Use tables for comparisons and
   timelines. Use task lists (`- [ ]`) for checklists.
7. **Internal links.** Link to at least two other resources (or the hub
   `/resources` when fewer than two exist), one product page (`/`, `/about`,
   `/security`), and the demo (`/signin`). Anchor text describes the target.
8. **FAQ.** Add 3–5 `faq` items that match real questions people ask (see the
   benchmark prompts in the editorial plan). They render visibly and mirror
   into FAQPage schema automatically — never put a question in front matter
   that the article does not answer.
9. **Metadata.** `title` 20–90 chars containing the primary keyword naturally
   (target 50–65). `description` 70–175 chars, specific, no clickbait.
   `primaryKeyword` + up to 8 `keywords`. Dates in `YYYY-MM-DD`.
10. **Product mentions.** Mention GrantConsole where the workflow genuinely
    connects, using verified facts only, and always after the reader has
    received the substantive answer. One CTA block is added automatically; do
    not paste marketing paragraphs into the body.
11. **No images from external hosts** (CSP). Self-hosted images go in
    `server/public/` and are referenced with an absolute path.
12. **Freshness.** When updating an article, change `updatedAt` and
    `factCheckedAt` only after re-checking the sources, and add a short
    "Update note" section if the substance changed.

## 5. Front matter reference

```yaml
---
title: Post-Award Grant Management Checklist for Nonprofits
description: A step-by-step post-award checklist for nonprofit grant recipients — deadlines, restricted budgets, evidence, reports and closeout, sourced to 2 CFR 200.
summary: >-
  One to three sentences that directly answer the page's question.
category: checklist          # guide | checklist | template | explainer | comparison | product
primaryKeyword: post-award grant management checklist
keywords: [grant compliance checklist, grant reporting deadlines]
intent: informational        # informational | commercial | comparison | utility
publishedAt: 2026-08-17
updatedAt: 2026-08-17
factCheckedAt: 2026-08-17
author: GrantConsole editorial team
# reviewer: (add only when a named, qualified reviewer actually reviewed it)
# path: /grant-tracking-software-for-nonprofits   (only for top-level product pages)
faq:
  - q: Question ending with a question mark?
    a: A complete answer of at least 40 characters.
sources:
  - title: 2 CFR 200.344 Closeout
    url: https://www.ecfr.gov/current/title-2/section-200.344
    checked: 2026-08-17
related: [grant-closeout-checklist]   # slugs of existing articles
# cta: { label: Open the live demo, href: /signin, text: Optional supporting sentence. }
# draft: true   (kept out of the site, sitemap and feed)
---
```

Body rules enforced by tests: 500–4,500 words; no `#` H1; at least two `##`
sections; at least one internal link; no external images; no HTML scripts,
iframes, forms or inline handlers; none of the forbidden phrases in
`server/lib/articles.ts` (placeholders, certification/pricing/customer/
guarantee/discovery claims). Guides, checklists, templates, explainers and
comparisons need at least one `https` source. Slug must equal the file name.

## 6. Publishing workflow (daily job)

1. `git clone` the repository and read this guide, `content/editorial-plan.json`
   and the titles/descriptions of everything already in `content/articles/`.
2. Take the first entry in the plan whose `status` is `planned`. Do not skip
   ahead unless the entry is blocked by a fact you cannot verify — then mark it
   `blocked` with a `blockedReason` and take the next one.
3. Research before writing: open the primary sources named in the brief with
   the fetch tool, confirm every number and quote you intend to use, and note
   the check date. Read the relevant product code if the article touches
   product mechanics.
4. Write `content/articles/<slug>.md` following sections 3–5.
5. Add the new article to `related` on one or two existing articles where the
   link is genuinely useful (this is how the cluster interlinks). If an earlier
   article links to `/resources` as a placeholder for this topic (for example
   "the closeout checklist"), point that link at the new path.
6. Update the plan entry: `status: published`, `publishedAt`, `path`, and any
   `notes`.
7. `npm ci` (or `npm install`) then `npm run verify` (lint, typecheck, tests,
   build). Fix problems until it is green. Never publish with failing tests.
8. Commit with the message `content: publish <slug>` and push to `main`.
   Production deploys automatically from `main`.
9. Confirm the live URL returns the new page (fetch it and check the title),
   confirm `/sitemap.xml` includes it, then report: URL, primary keyword, word
   count, sources used, what is queued next, and anything blocked.

If anything upstream is broken (tests failing before your change, deploy not
updating, credentials missing), stop, do not force-push or work around
safeguards, and report the exact error.

## 7. Choosing new topics once the plan runs dry

Stay inside the post-award cluster and its natural neighbors: deadline and
renewal tracking, restricted budgets and burn, evidence and audit files,
funder reporting, compliance and prior approvals, closeout, subrecipient
monitoring, board/leadership oversight, spreadsheet-to-software migration,
role clarity between grants and finance teams, and honest comparisons of
recipient-side tools. Prefer questions people actually ask an assistant (see
the benchmark prompts in the plan). Skip topics we cannot source. Append new
entries to `content/editorial-plan.json` with a brief so the next run has a
queue.
