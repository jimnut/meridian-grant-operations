---
name: GrantConsole — Marketing Landing
description: The product's front door in daylight — ink-blue story panel, warm paper, white specimen cards, finance-grade mono accents.
colors:
  panel: "#1b2129"
  panel-soft: "#232b36"
  panel-edge: "#313b48"
  panel-text: "#eef0f2"
  panel-muted: "#a7b0ba"
  paper: "#f7f6f3"
  card: "#ffffff"
  edge: "#e2dfd8"
  ink: "#20242b"
  ink-soft: "#565d66"
  amber: "#e9973f"
  amber-ink: "#8a5410"
  amber-deep: "#c4761f"
  teal-ink: "#1d6e63"
  risk-ink: "#b3362a"
  app-paper: "#f6f4ef"
  app-ink: "#14231d"
  app-ink-soft: "#46534b"
  app-green: "#1c6b58"
  app-risk: "#a33d31"
  app-risk-soft: "#f7e5e2"
  app-amber-soft: "#f7edda"
  app-amber-ink: "#7a5a18"
typography:
  display:
    fontFamily: "Archivo, -apple-system, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "clamp(36px, 4vw, 54px)"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Archivo, -apple-system, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "clamp(26px, 3vw, 34px)"
    fontWeight: 800
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Archivo, -apple-system, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Archivo, -apple-system, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "16.5px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.12em"
  data:
    fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "14px"
    fontWeight: 600
    letterSpacing: "0.04em"
rounded:
  tag: "4px"
  control: "8px"
  card: "10px"
  frame: "12px"
spacing:
  tight: "10px"
  grid: "20px"
  gutter: "24px"
  wide: "28px"
  section: "72px"
components:
  button-demo:
    backgroundColor: "{colors.panel}"
    textColor: "#ffffff"
    typography: "{typography.data}"
    rounded: "{rounded.control}"
    padding: "15px 20px"
  button-demo-hover:
    backgroundColor: "{colors.panel-soft}"
  button-demo-mobile:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.panel}"
  persona-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "13px 16px"
  tag-risk:
    textColor: "{colors.risk-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "4px 9px"
  tag-watch:
    textColor: "{colors.amber-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "4px 9px"
  tag-teal:
    textColor: "{colors.teal-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    padding: "4px 9px"
  mono-link:
    textColor: "{colors.amber-ink}"
    typography: "{typography.data}"
---

# Design System: GrantConsole — Marketing Landing

## Overview

**Creative North Star: "The Working Front Door"**

The landing page is not a brochure about the product; it is the product's own front door left open. Its structure is the app sign-in's split screen — story panel left, working demo roster right — and everything on the page is drawn from the seeded demo workspace: real rule names, real grant titles, real numbers. The personality is finance-grade honesty made warm: a deep ink-blue panel speaks the promise, warm paper carries the proof, and JetBrains Mono marks every machine truth (tags, rules, sums, the demo password) the way a ledger marks entries. Amber is the single voice of emphasis, and it is spent carefully.

Density is editorial, not dashboard: generous 72px section rhythm, one column of argument at a time, specimen cards presented like catalog exhibits with the app's own palette quoted inside them. The page rejects the single-column hero-scroll SaaS default, rejects invented social proof entirely (the reviews section exists in the source but is commented out until real quotes exist), and rejects decoration that the product could not back with a rule.

**Boundary (do not cross in either direction):** this file documents the MARKETING SURFACE world only — `server/public/landing.html`, a dependency-free static page with inline CSS and embedded fonts. The React app keeps its own separate incumbent system, "calm stewardship" (warm paper, deep forest green, teal accent — `client/styles/tokens.css`). App surfaces must not adopt this landing language, and future landing work must not import app tokens — except as quoted material inside exhibit panels (see The Quoted Palette Rule).

**Key Characteristics:**
- Split-screen front door: ink-blue story panel + warm-paper action panel, borrowed from the app's own sign-in.
- Two typefaces, two jobs: Archivo (variable, embedded) argues; JetBrains Mono testifies.
- Boxed uppercase mono tags as the semantic voice: risk red, watch amber, teal rule/fact.
- Specimen cards whose exhibits depict the real product in the app's own (quoted) palette.
- Flat hairline world, one shadow, one animation.
- Everything self-contained: fonts as data URIs, strict CSP, zero external requests.

## Colors

An ink-blue-and-paper world where amber is the only raised voice, and the app's forest-green palette appears strictly as quoted evidence.

### Primary
- **Signal Amber** (#e9973f): the bright accent — exists only against the dark panel. Mechanism-bullet icons, links inside the story panel, ledger expressions, the mobile CTA fill, the wordmark "G". Never used as text on light grounds (fails AA there).
- **Burnt Amber** (#8a5410): amber's voice on light grounds — default link color, mono links, WATCH tags, the owner role tag, the bolded demo password. AA-safe on paper and white.
- **Amber Deep** (#c4761f): the working amber — focus-visible outlines, hover border color on persona cards, the FAQ +/− marker.

### Secondary
- **Teal Ink** (#1d6e63): the fact/rule voice — rule-number tags and persona role tags. Always as `currentColor` text + 1px border, never as a fill.
- **Risk Ink** (#b3362a): AT RISK tag ink. Reserved for genuine risk semantics; never decorative.

### Neutral
- **Panel** (#1b2129): the deep ink-blue ground — story panel, ledger band, demo CTA fill, `theme-color`. Ground inversion with this color is how the page creates weight.
- **Panel Soft** (#232b36) / **Panel Edge** (#313b48): raised surface and hairline on the dark ground (CTA hover, wordmark tile).
- **Panel Text** (#eef0f2) / **Panel Muted** (#a7b0ba): primary and secondary text on the dark ground.
- **Paper** (#f7f6f3): the warm page ground — body background and the action panel.
- **Card** (#ffffff): persona cards, specimen cards, the screenshot frame.
- **Edge** (#e2dfd8): the universal 1px hairline — card borders, section dividers, rulebook and FAQ row separators.
- **Ink** (#20242b) / **Ink Soft** (#565d66): body text and supporting text on light grounds.

### Quoted App Palette (exhibits only)
These `--app-*` tokens depict the product inside `.exhibit` panels and nowhere else: **App Paper** (#f6f4ef), **App Ink** (#14231d), **App Ink Soft** (#46534b), **App Green** (#1c6b58), **App Risk** (#a33d31), **App Risk Soft** (#f7e5e2), **App Amber Soft** (#f7edda), **App Amber Ink** (#7a5a18). They are the app's calm-stewardship colors reproduced as evidence, like a screenshot rendered in CSS.

### Named Rules
**The Two Ambers Rule.** Bright amber (#e9973f) lives only on the dark panel; on paper or white, amber always appears as Burnt Amber (#8a5410) for text and Amber Deep (#c4761f) for borders/focus. There is no context where bright amber sits as text on a light ground.

**The Quoted Palette Rule.** The `--app-*` colors are quoted material: they appear exclusively inside exhibit panels that depict the product. The landing never speaks in the app's forest green, and the app never speaks in the landing's ink-blue or bright amber.

**The Border-Not-Fill Rule.** Semantic color (risk, watch, teal) is carried as tag text + 1px `currentColor` border on white — never as a filled chip. The only filled pill on the page lives inside an exhibit, quoting the app.

## Typography

**Display Font:** Archivo (variable, 100–900, embedded as woff2 data URI; fallback -apple-system, 'Helvetica Neue', Arial, sans-serif)
**Body Font:** Archivo (same embedded variable face)
**Label/Mono Font:** JetBrains Mono (variable, 100–800, embedded as woff2 data URI; fallback ui-monospace, 'SF Mono', Menlo, monospace)

**Character:** A grotesque that argues and a monospace that testifies. Archivo runs heavy (800) and tight-tracked for headings, plain at 16.5px/1.6 for body; JetBrains Mono marks everything machine-derived. The variable font allows intermediate weights — the build uses 650 for in-line emphasis (`.mech strong`, rulebook rule names, FAQ summaries).

### Hierarchy
- **Display** (800, clamp(36px, 4vw, 54px), 1.05, -0.025em): the hero h1 only, `text-wrap: balance`; drops to 33px below 560px.
- **Headline** (800, clamp(26px, 3vw, 34px), -0.02em): section h2s and the closing h2. The action-panel h2 is a one-off 27px sibling.
- **Title** (700, 17px, -0.01em): specimen caption h3s. Persona names are 700 at 15px.
- **Body** (400, 16.5px, 1.6): base text. Lede runs 18px; captions 14.5px; support notes 13–13.5px. Measure is capped (60ch story, 62ch section subs, 70ch FAQ answers).
- **Label** (mono 600, 12px, 0.12–0.16em, UPPERCASE): boxed tags, roster label, wordmark subtitle, role tags.
- **Data** (mono 600, 14–15px): CTAs, mono links, ledger expressions, captions/source lines, the demo password, footer colophon.

### Named Rules
**The Mono Voice Rule.** JetBrains Mono is reserved for machine truth: tags, rule numbers, data expressions, source captions, CTAs, the password, the colophon. If the product computed it or enforces it, it is mono; if a human is being persuaded, it is Archivo. Never mix within one phrase's role.

## Layout

The first viewport is a split grid — `grid-template-columns: minmax(0, 11fr) minmax(0, 9fr)`, `min-height: 92vh` — story panel left (padding 30px 64px 44px, core content vertically centered with `margin: auto 0`), action panel right (content column max 460px, centered). Below the fold, all sections share `.wrap` (max-width 1120px, 24px gutters) and a 72px top rhythm (`section { padding: 72px 0 8px }`).

Section grids: the rulebook specimen grid is 3 columns with the lead specimen spanning 2 and the wide specimen spanning all 3 (exhibit and caption side-by-side); the ledger is a 3-column dark band; coverage is a 2-column definition list with 48px column gap; FAQ and rulebook rows are single-column hairline-separated lists. Grid gaps: 10px (roster), 20px (specimens), 28px (ledger).

Responsive: at 980px the split collapses to one column, the amber mobile CTA appears inside the story panel, and every multi-column grid collapses to one column (the wide specimen restacks vertically). At 560px the h1 fixes to 33px, the calendar exhibit drops to 2 columns, and rulebook rows wrap. No document-level horizontal overflow at 390/768/1440.

## Elevation & Depth

This is a flat hairline world. Depth is conveyed by ground inversion — the dark panel (#1b2129) against paper (#f7f6f3) against white cards — and by 1px #e2dfd8 borders, not by shadows. Exactly one shadow exists on the page.

### Shadow Vocabulary
- **Screenshot lift** (`box-shadow: 0 18px 40px -24px rgba(32, 36, 43, 0.35)`): the `.shot-frame` around the real product screenshot, and nothing else. It exists to make the one bitmap on the page read as a physical exhibit.

### Named Rules
**The One Shadow Rule.** New surfaces do not earn shadows. Separation comes from a 1px Edge hairline or a ground change; the screenshot frame keeps the page's only shadow.

## Shapes

Rectangles with small, purposeful radii on a four-step scale: 4px (tags), 8px (buttons, screenshot image), 10px (persona and specimen cards), 12px (screenshot frame, ledger band). Nested corners step down by 1px — the exhibit panel is 9px inside its 10px card, the screenshot image 8px inside its 12px frame. Borders are 1px hairlines everywhere (#e2dfd8 on light, #313b48 on dark); the evidence checklist inside exhibits uses 1px dashed dividers. The 999px pill radius appears only inside exhibits, quoting the app's pill badges. Tags are boxed: 1px `currentColor` border, 4px radius, uppercase mono — never borderless, never filled.

## Components

### Buttons
- **Shape:** softly squared (8px radius), mono voice.
- **Primary (`.btn-demo`):** Panel fill (#1b2129), white text, JetBrains Mono 600 14px with 0.04em tracking, uppercase copy ("OPEN THE LIVE DEMO →"), padding 15px 20px, 1px border in the fill color.
- **Hover / Focus:** fill lightens to Panel Soft (#232b36); focus-visible gets a 2px #c4761f outline offset 3px (the global focus treatment for links, buttons and summaries).
- **Mobile variant (`.btn-demo--mobile`):** Signal Amber fill with Panel text — appears only inside the dark story panel below 980px, where bright amber is legal.

### Chips / Tags (`.tag`)
- **Style:** uppercase JetBrains Mono 600 12px, 0.12em tracking, 4px 9px padding, 1px `currentColor` border, 4px radius, transparent background.
- **Variants:** `tag--risk` (#b3362a, "AT RISK"), `tag--watch` (#8a5410, "WATCH"), `tag--teal` (#1d6e63, rule numbers and facts). Persona role tags reuse the same grammar (teal for roles, burnt amber for OWNER).

### Cards / Containers
- **Persona card (`.persona`):** white, 1px Edge border, 10px radius, 13px 16px padding; name 700/15px over a 13.5px Ink Soft title, role tag right. Hover swaps the border to Amber Deep. The whole card is a link to /signin.
- **Screenshot frame (`.shot-frame`):** white, 12px radius, 10px padding, the page's only shadow; image inside gets 8px radius and a hairline. Mono caption (12.5px) below.
- **Ledger band (`.ledger`):** Panel-dark container, 12px radius, 28px 30px padding, 3-column; each fact leads with an amber mono expression (15px) over a Panel Muted note.

### The Specimen Card (signature component)
The page's own invention: a white card (1px Edge, 10px radius) split into an **exhibit** — an App Paper (#f6f4ef) panel, 22px padding, that depicts a real product moment in the quoted app palette (attention item, burn bar, calendar week, evidence checklist) — and a **caption**: tag row (severity tag + teal rule number), 17px/700 h3, 14.5px explanation, and a mono `src` line crediting the live demo workspace. Exhibits carry `role="img"` + `aria-label` when they are pictorial. The wide variant lays exhibit and caption side-by-side, exhibit taking flex 1.15.

### Links
- **Default:** Burnt Amber (#8a5410) on light grounds; Signal Amber (#e9973f) inside the story panel; footer/support links in Ink Soft / Panel Muted.
- **Mono link (`.mono-link`):** JetBrains Mono 600 14px, Burnt Amber, underlined with 5px underline offset; hover shifts to Ink. Used for "See the rulebook working →" evidence links.

### FAQ Accordion (`.faq`)
Native `<details>/<summary>` rows separated by Edge hairlines; summary is Archivo 650 16.5px with a mono +/− marker in Amber Deep (content-swapped on `[open]`); answers are Ink Soft 15px, indented 30px, max 70ch. No JavaScript.

### Navigation
There is no nav bar. The only chrome is the wordmark (36px rounded tile: Panel Soft fill, Panel Edge stroke, amber Archivo "G") with name (700/18px) over an uppercase mono subtitle, and a mono story-foot line. Keep it that way; the page has one destination (/signin).

### Motion (lives with the roster)
**The Single Settle Rule.** The page has exactly one authored animation: the four persona cards settle in once on load — `translateY(6px) → 0` with fade, 0.5s `cubic-bezier(0.16, 1, 0.3, 1)`, 70ms stagger starting at 0.15s, `backwards` fill — fully disabled under `prefers-reduced-motion` (which also reverts smooth scrolling). Everything else limits itself to instant hover color/border swaps. New sections do not add movement.

## Do's and Don'ts

### Do:
- **Do** keep the page entirely self-contained: inline CSS, both fonts embedded as woff2 data URIs, no external requests, strict CSP (see `server/lib/site.ts`). Adding a CDN, external font, or third-party script is a deliberate architecture decision, not a styling choice.
- **Do** preserve every SEO surface on any edit: `<link rel="canonical" href="https://grantconsole.com/">`, the JSON-LD `@graph` trio (SoftwareApplication, Organization, FAQPage — the FAQPage entries must keep matching the visible FAQ), the OG/Twitter image (`/og-image.png`, 1200×630), the `<!--ANALYTICS-->` placeholder comment, `theme-color` #1b2129, and the Express-served `/robots.txt` and `/sitemap.xml`.
- **Do** hold the accessibility floor the build ships: WCAG AA contrast on every text/ground pair (Burnt Amber, never Signal Amber, for text on light), the global 2px #c4761f focus-visible outline at 3px offset, `aria-label`s on pictorial exhibits and the roster nav, semantic `<details>` FAQ, and reduced-motion coverage for any motion or smooth scroll.
- **Do** draw all proof from the seeded demo: real rule names, real grant and persona names, real numbers, with a mono source line crediting the live demo workspace.
- **Do** show the demo password in plain text (`GrantConsole!Demo2026`) — it is public by design; the bolded Burnt Amber treatment is the pattern.
- **Do** keep money and rules in mono: any figure, rule number, or computed claim renders in JetBrains Mono.

### Don't:
- **Don't** invent proof. No testimonials, customer names, logos, pilot claims, or usage numbers; the commented-out `<!-- REVIEWS -->` section stays dormant until real, permissioned quotes exist — never activate it with placeholders.
- **Don't** bleed worlds across the boundary: no landing ink-blue/bright-amber inside the React app, and no app forest-green on the landing outside a quoted exhibit panel (`client/styles/tokens.css` owns the app; this file owns the landing).
- **Don't** put Signal Amber (#e9973f) text on paper or white — it fails AA there; use Burnt Amber (#8a5410).
- **Don't** add shadows (the screenshot frame keeps the only one), gradients used as decoration, filled semantic chips outside exhibits, or any animation beyond the roster settle.
- **Don't** add a navigation bar, secondary CTAs, or destinations other than /signin and mailto:support — the page earns exactly one action.
