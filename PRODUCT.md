# PRODUCT.md

## Product

GrantConsole — a post-award grant operations workspace for nonprofit teams. Recipient-side only: it manages the obligations attached to money already won (deadlines, restricted budgets, compliance evidence, funder reports, renewals). It is explicitly not a fundraising CRM and not a grant-discovery database.

## Users and jobs

- Grants/development managers at small-to-midsize nonprofits juggling ~5–25 restricted grants through spreadsheets, email threads and a shared drive.
- Finance leads tracking restricted spend against grant periods.
- Executive directors and board treasurers who need a defensible answer to "are we on top of our grants?"
- Job to be done: never miss a funder obligation; always know what needs attention today and why; walk into any audit or funder meeting with the packet ready.

## Position / mechanism

- Wedge: post-award operations (competitors: Instrumentl, Fluxx, Grantable, GrantVantage, AmpliFund — mostly discovery- or enterprise-oriented).
- Differentiating mechanism: a transparent rule engine. Every risk signal states the rule that produced it ("'Monthly expenditure report' was due 12 days ago") — no opaque health scores. Money is integer cents; budget burn is measured against elapsed grant period, not the calendar.
- Pricing (published 2026-09-06 after competitor/buyer research): Starter $79/mo ($65 annual, 10 active grants), Growth $179 ($149, 40 grants, most popular), Scale $349 ($290, unlimited). 14-day no-card trial. Anchors: GrantHub (~$95/mo, sunset Jan 2026), GrantCue $109–$229, MonkeyPod $167–$199, GrantHub Pro $349, Instrumentl post-award only at $999/mo. ~$8K MRR ≈ 45 customers at a 50/40/10 mix.

## Truthful proof status (confirmed 2026-08-10)

Launched for self-serve trials 2026-09-06. Still no customers, pilots, testimonials, logos, or usage numbers may be claimed. The product, the live seeded demo (/signin, demo mode) and the free trial (/signup) are the proof.

## Durable facts and constraints

- Live at https://grantconsole.com; app is session-gated; anonymous `/` serves the marketing landing (server/public/landing.html, plain static HTML/CSS served by Express — no build step; inline CSS; strict CSP: no external requests except Google Analytics hosts when enabled).
- Brand name: GrantConsole (committed 2026-08-10; renamed from "Meridian"). Support email support@grantconsole.com.
- The in-app design system ("calm stewardship": warm paper, deep forest green, teal accent) belongs to the app. The landing page is NOT bound to it (full-redesign freedom confirmed 2026-08-10); product voice must stay honest, specific, finance-grade.
- Accessibility is a product value: WCAG AA contrast, semantic structure, keyboard support — the app ships it and the marketing surface must not undercut it.
- SEO surfaces (canonical, JSON-LD SoftwareApplication/Organization/FAQPage, robots, sitemap, OG image) exist and must survive any redesign.
- Demo password is public by design: GrantConsole!Demo2026.

## Platform

web

## Stack

Landing surface: intentionally dependency-free static HTML with inline CSS (self-contained, CSP-locked, no external fonts/CDNs). Confirmed by deploy architecture; changing this requires a deliberate decision. App: React 18 + Vite SPA over Express/SQLite (not in scope for marketing work).
