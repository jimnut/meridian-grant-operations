---
name: GrantConsole — Product and Public Design
description: A calm post-award command center: dark operational canvas, exact product evidence, warm readable content, and a restrained glass control layer.
colors:
  night: "#07141a"
  nightSoft: "#0d2027"
  paper: "#f3f6f2"
  paperSoft: "#e7eee9"
  card: "#ffffff"
  ink: "#10201b"
  inkSoft: "#5c6b65"
  edge: "#d8e1db"
  signal: "#49dda9"
  signalDeep: "#08785b"
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

1. **Cursor-like product evidence:** the real interface is the hero. Large product frames, concise claims, status language, and generous negative space replace decorative illustrations.
2. **Liquid control layer:** translucency belongs only on navigation, menus, dialogs, command surfaces, and a small number of elevated control islands. Content tables and data cards remain stable, readable surfaces.
3. **GrantConsole accountability:** mono labels identify rules, amounts, roles, and machine-readable facts. Emerald communicates the primary action or selected state. Risk never depends on color alone.

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

1. Compact dark navigation with product, risk, team, security, FAQ, sign-in, and live-demo paths.
2. Category statement and brand promise.
3. Real dashboard in a dark product frame.
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
- Use a dark operational hero and warm neutral content sections.
- Glass is limited to the product frame, one status note, and the integrity panel.
- Use system fonts for speed and privacy: a system sans, platform serif, and system mono.
- Use no JavaScript for layout or FAQ behavior. Native details provides the accordion.
- Mobile layouts must prioritize copy and actions before the wide product image.

## Application

The React application uses the semantic tokens in client/styles/tokens.css.

- Sidebar and persistent navigation remain predominantly opaque for contrast.
- Topbar, command palette, menus, dialogs, and transient control clusters may use the shared glass material tokens.
- Tables, portfolio cards, grant records, inputs, banners, and status surfaces remain solid.
- Concentric radii step down from shell to nested panel to control.
- Hover changes luminance/border; pressed controls may scale to 0.98.
- Focus retains the high-contrast visible ring.
- Respect prefers-reduced-motion, prefers-reduced-transparency, and higher-contrast preferences.

## Typography

- **Hero display:** platform serif, weight 500, very tight tracking.
- **Application headings:** system sans with strong hierarchy and restrained tracking.
- **Body:** system sans, 15–20px depending on context.
- **Machine truth:** system mono for risk rules, roles, dates, labels, and source notes.
- Keep line lengths near 60–72 characters for explanatory content.

## Color and state

- **Night** is the product/hero canvas.
- **Paper** is the reading canvas.
- **Signal emerald** is reserved for the primary CTA, selection, progress, and positive machine state.
- **Watch amber** and **Risk red** require a written label or icon; never communicate state through color alone.
- Text on dark surfaces uses near-white and desaturated gray-green, not pure white for every hierarchy.
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
- no fake reviews, ratings, prices, customers, certifications, integrations, founder facts, or usage claims.

The visible FAQ and FAQPage JSON-LD must remain exactly aligned. Structured data describes the page; it is not a ranking shortcut.

## Proof policy

Current public proof is the product itself:

- the seeded demo;
- real product screens;
- eleven implemented rule types;
- exact budget/date/activity mechanics;
- verified application-security behavior.

GrantConsole is pre-launch. Do not publish customer logos, testimonials, pilot claims, pricing, growth metrics, or third-party certifications until there is real evidence and permission.

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
