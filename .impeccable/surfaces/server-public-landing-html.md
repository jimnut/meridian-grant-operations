---
version: 1
slug: "server-public-landing-html"
primary_target: "server/public/landing.html"
related_targets: []
---

Scope: the public marketing landing served at / to anonymous visitors (server/public/landing.html). Mode: Persuade.

Audience and job: nonprofit grants managers, finance leads and executive directors deciding whether this tool deserves a look; the page must earn one action, opening the live demo at /signin.

Proof and content constraints: pre-launch, demo only (confirmed 2026-08-10). No testimonials, customers, logos or usage numbers. The only proof is the product itself: real risk signals, rules and data drawn truthfully from the seeded demo workspace. Demo password is public by design and shown in plain text. A commented-out REVIEWS section stays dormant until real, permissioned quotes exist.

Chosen direction (as built, recorded 2026-08-11; supersedes the earlier dark specimen-catalog draft): the product's front door in daylight. The first viewport reuses the app sign-in's split structure — deep ink-blue story panel (#1b2129) left with the headline, three mechanism bullets and bright-amber (#e9973f) accents; warm-paper (#f7f6f3) action panel right with the demo CTA and a roster of four persona cards (white, hairline-edged) that settle in once on load, the page's single authored animation. Below, light sections on warm paper: white specimen cards whose exhibit panels quote the app's own calm-stewardship palette (app paper #f6f4ef, forest green #1c6b58, desaturated risk red #a33d31) above Archivo captions carrying boxed uppercase mono tags (AT RISK #b3362a, WATCH #8a5410, teal rule/fact #1d6e63); a real dashboard screenshot in the page's only shadowed frame; one dark ledger band for the finance facts; burnt-amber mono links; a native details/summary FAQ. Archivo variable (display and body) and JetBrains Mono (tags, data, CTAs), both embedded as data URIs. Full token record and named rules: DESIGN.md at the project root (marketing-surface world only; the React app keeps calm stewardship).

Constraints: zero external requests (fonts embedded as data URIs; strict CSP), all SEO surfaces preserved (canonical, JSON-LD SoftwareApplication/Organization/FAQPage matching visible FAQ, OG image, <!--ANALYTICS--> placeholder, /robots.txt and /sitemap.xml routes), WCAG AA contrast (bright amber never as text on light grounds), focus-visible outlines, reduced-motion coverage, no document-level horizontal overflow at 390/768/1440.

Unresolved: whether the app's own sign-in surface should pick up any of this landing language (currently it stays in the app's calm-stewardship world); Semrush keyword pass still pending API units.
