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
- Research target (2026-08 sheet): ~$8K MRR ≈ 17 customers; future pricing hypothesis ~$499/mo. None of this is published on the site.

## Truthful proof status (confirmed 2026-08-10)

Pre-launch. Demo only. No customers, pilots, testimonials, logos, or usage numbers may be claimed. The product itself and the live seeded demo are the only proof. The demo is one click, no sign-up, at /signin (demo mode).

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
