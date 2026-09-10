---
name: GrantConsole — Product and Public Design
description: A calm post-award workspace with daylight surfaces, exact product evidence, forest-green actions, and restrained lime highlights.
colors:
  night: "#172b15"
  nightSoft: "#284723"
  paper: "#f7f8f5"
  paperSoft: "#edf0e9"
  card: "#ffffff"
  ink: "#111512"
  inkSoft: "#626962"
  edge: "#e0e5dc"
  signal: "#3d7b32"
  signalDeep: "#2f6f2b"
  highlight: "#d8ff75"
  watch: "#efaa4f"
  risk: "#dc665c"
rounded:
  control: "13px"
  card: "14px"
  panel: "22px"
  hero: "32px"
motion:
  fast: "170ms"
  easing: "cubic-bezier(0.2, 0.75, 0.25, 1)"
---

# GrantConsole design system

## North star

**The clear next move.**

GrantConsole should feel like a beautifully built operating instrument, not a generic nonprofit brochure. The interface makes the product's core promise visible: every portfolio signal is tied to a real obligation, record, date, budget, and owner.

The visual system combines three ideas:

1. **Real product evidence:** the actual interface is the hero. Product frames, concise claims, clear status language, and generous negative space make the product inspectable.
2. **Quiet daylight surfaces:** white navigation and cards sit on a light gray-green canvas. Fine borders organize information; shadows and translucency are reserved for menus, dialogs, and transient controls.
3. **GrantConsole accountability:** every amount, date, role, and risk signal comes from real records. Forest green identifies actions and selection; lime is a restrained brand highlight. Risk never depends on color alone.

These are principles, not copies of another company's interface or assets.

## Brand and voice

- **Brand promise:** “Every grant obligation, accounted for.”
- **Category:** Post-award grant management software for nonprofit teams.
- **Voice:** calm, exact, candid, operational.
- **Preferred questions:** “What must happen before Friday?”, “Which grant needs a decision?”, “What evidence is still missing?”
- **Avoid:** vague impact language, unsupported superlatives, invented social proof, generic AI claims, or copy that confuses grant recipients with grantmakers.

## Public landing

The public landing is server/public/landing.html, a dependency-free, server-rendered page.

### Page sequence

1. Compact floating white navigation with features, pricing, resources, FAQ, sign-in, and trial paths.
2. Category statement and brand promise.
3. Real daylight dashboard in a dark device frame.
4. Four concrete proof units from seeded data.
5. Clear category boundary: discovery, fundraising CRM, and post-award operations.
6. Three decision-oriented workflows: attention, restricted budget burn, and evidence.
7. Explainable risk-rule section.
8. Role-specific questions for grants, finance, program, and leadership.
9. Inspectable calculation/security facts.
10. Visible FAQ, final demo CTA, and trust-page footer.

### Public-page rules

- Use the real product screenshot and seeded workspace facts.
- Keep every important statement as crawlable HTML; screenshots support the copy rather than replace it.
- Use a light hero, green feature surfaces, and occasional dark or lime action sections.
- Use locally hosted Archivo for brand and interface typography; system serif is retained for long-form articles and printable reports.
- Use no JavaScript for layout or FAQ behavior. Native details provides the accordion.
- Mobile layouts must prioritize copy and actions before the wide product image.

## Application

The React application uses the semantic tokens in client/styles/tokens.css.

- Sidebar and persistent navigation use opaque white surfaces, readable dark labels, and a soft green selected state.
- The topbar, command palette, menus, and dialogs may use restrained translucent surfaces.
- Tables, portfolio cards, grant records, inputs, banners, and status surfaces remain solid.
- Concentric radii step down from shell to nested panel to control.
- Hover changes luminance/border; pressed controls may scale to 0.98.
- Focus retains the high-contrast visible ring.
- Respect prefers-reduced-motion, prefers-reduced-transparency, and higher-contrast preferences.
- Present dashboard priorities above four clear metric tiles. Keep the demo invitation compact and visibly separate from real portfolio signals.
- Shared navigation tokens are dark text for light surfaces. Dark buttons must use explicitly light text rather than navigation text tokens.
- Authentication uses the same four-square mark, a pale green story panel, white form area, and compact demo persona controls. Illustrations are explicitly labelled; never invent customer data or outcomes.

## Typography

- **Hero display:** locally embedded Archivo, strong weight, tight tracking.
- **Application headings:** locally hosted Archivo with strong hierarchy and restrained tracking.
- **Body:** Archivo for the interface; a readable system serif for article bodies.
- **Machine truth:** system mono for risk rules, roles, dates, labels, and source notes.
- Keep line lengths near 60–72 characters for explanatory content.

## Color and state

- **Paper** is the product and reading canvas; white is the navigation and card surface.
- **Night** is reserved for primary buttons and occasional public-page contrast sections.
- **Signal green** identifies links, selection, progress, and positive machine state. Lime highlights the brand and selected summary surfaces.
- **Watch amber** and **Risk red** require a written label or icon; never communicate state through color alone.
- Text on dark surfaces uses explicitly light colors, independently of light navigation tokens.
- All text/control combinations must meet WCAG AA contrast.

## Motion

- Interaction transitions last 120–180ms with the emphasized easing token.
- No perpetual shimmer, refraction, pulsing, or decorative parallax.
- Product cards do not float continuously.
- Reduced-motion preferences remove authored transitions and smooth scrolling.

## SEO and trust contract

Every public-page edit must preserve:

- one descriptive title and H1;
- page-specific description, canonical, Open Graph, and X metadata;
- indexable server-rendered copy;
- the ANALYTICS injection point;
- accurate Organization, WebSite, WebPage, SoftwareApplication, and visible-FAQ structured data where applicable;
- crawlable links to About, Contact, Security, Privacy, and Demo Terms;
- robots.txt, the public XML sitemap, and true 404 responses;
- descriptive image alternative text;
- no fake reviews, ratings, customers, certifications, integrations, founder facts, or usage claims; prices only from shared/plans.ts.

The visible FAQ and FAQPage JSON-LD must remain exactly aligned. Structured data describes the page; it is not a ranking shortcut.

## Proof policy

Current public proof is the product itself:

- the seeded demo;
- real product screens;
- eleven implemented rule types;
- exact budget/date/activity mechanics;
- verified application-security behavior.

GrantConsole launched self-serve trials and published pricing on 6 September 2026 (see shared/plans.ts; the pricing page renders from it). Do not publish customer logos, testimonials, pilot claims, growth metrics, or third-party certifications until there is real evidence and permission.

## Accessibility

- Use semantic landmarks, headings, lists, links, and buttons.
- Keep a visible 3px focus ring with spacing from the target.
- Make interactive targets comfortably touchable.
- Give meaningful screenshots descriptive alternative text; decorative marks use empty alt text.
- Keep information available at 200% zoom and on narrow mobile widths.
- Pair every risk color with a label and explanation.
- Provide opaque fallbacks for glass materials.

## Do / do not

### Do

- Put the product in the first viewport.
- Lead with category clarity and the next decision.
- Reuse the real seeded workspace as evidence.
- Keep content, controls, and status visually distinct.
- Prefer one excellent CTA path over scattered button styles.
- Keep trust and limitations easy to find.

### Do not

- Copy competitor wording, layouts, icons, trademarks, or product imagery.
- Add glass to every surface.
- Invent proof to make the page feel mature.
- Hide essential content inside imagery or client-only rendering.
- Add external fonts or trackers without an explicit product/privacy decision.
- Create thin SEO pages for keyword variants.

## Marketing homepage refresh

The website and authenticated application share one light, product-first identity. The public landing surface uses a floating white navigation bar, a dotted daylight canvas, an oversized centered product promise, a device-framed application view, modular feature panels, a dark live-demo block, and a lime closing action. Pricing, resources, trust pages, and authentication carry the same typography, four-square mark, and green palette.

Shared brand colors are `#f7f8f5` background, `#ffffff` surface, `#111512` ink, `#626962` supporting text, `#dde2dc` hairline, `#57a546` brand green, `#2f6f2b` deep green, `#eaf5e5` soft green, and `#d8ff75` highlight lime. Archivo remains local; the app and shared public pages reuse `/fonts/archivo-latin.woff2`, extracted from the existing embedded homepage font. No third-party font request is introduced.

Trial, pricing, sign-in, resources, trust, analytics, structured-data, and crawlability contracts remain part of the page. Product examples and numbers must come from implemented behavior or seeded records; the homepage must not invent customers, outcomes, integrations, certifications, or usage claims.
