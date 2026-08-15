# GrantConsole — Grant Operations

> Live at **[grantconsole.com](https://grantconsole.com)** — anonymous visitors get an indexable
> marketing page (`server/public/landing.html`); a session cookie routes straight to the app.
> The SPA shell itself is `noindex`; `robots.txt` and `sitemap.xml` are served by the API server.

**One calm workspace for nonprofit grant teams to manage deadlines, restricted budgets, compliance work, supporting evidence, renewal history, and audit-ready funder reports.**

GrantConsole is a recipient-side, **post-award grant health command center** for small and midsize nonprofits — the teams juggling several restricted grants at once through spreadsheets, email threads and a shared drive. It is not a fundraising CRM and not a grant-discovery database. Its job is to answer three questions honestly:

1. What needs attention today, and *why*?
2. Are we ready to report, and what exactly is missing?
3. Where do restricted funds actually stand against the grant period?

Every risk signal states the rule that produced it. There are no opaque scores.

---

## Quick start

Requires **Node 20.11+** (developed and verified on Node v20.11.1 / npm 10.2.4). No other services needed — data lives in a local SQLite file.

```bash
npm install
npm run demo          # create the database, seed the demo workspace, start the app
```

Then open **http://localhost:5173** and click any demo account to sign in.

`npm run demo` runs the Vite dev server (port 5173) with the API on port 4000. To run the production build instead:

```bash
npm run serve         # seed if needed, build, then serve everything from http://localhost:4000
```

### Demo accounts

Every seeded account uses the same password:

```
GrantConsole!Demo2026
```

| Email | Role | Person | Organization |
| --- | --- | --- | --- |
| `dana@riverbendalliance.org` | **Owner** | Dana Whitfield, Executive Director | Riverbend Community Alliance |
| `marcus@riverbendalliance.org` | **Manager** | Marcus Oyelaran, Director of Development & Grants | Riverbend Community Alliance |
| `priya@riverbendalliance.org` | **Member** | Priya Raghunathan, Grants & Compliance Coordinator | Riverbend Community Alliance |
| `naomi@riverbendalliance.org` | **Member** | Naomi Feldstein, Finance Manager | Riverbend Community Alliance |
| `tomas@riverbendalliance.org` | **Viewer** | Tomás Herrera, Board Treasurer | Riverbend Community Alliance |
| `renee@cascadeyouth.org` | **Owner** | Renée Baptiste, Executive Director | Cascade Youth Collective |
| `wes@cascadeyouth.org` | **Member** | Wes Ordoñez, Program Manager | Cascade Youth Collective |

Dana also holds a **Viewer** seat at Cascade Youth Collective, which exercises the organization switcher and proves roles are per-organization. Sign-in lands you in the organization where you hold the most authority.

**Two organizations are seeded on purpose.** Sign in as `priya@…` (Riverbend only) and as `wes@…` (Cascade only) to confirm neither can see or touch the other tenant's records.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run demo:setup` | Create `data/`, apply the schema, and seed **only if the workspace is empty**. |
| `npm run demo` | `demo:setup`, then start API + web dev servers. |
| `npm run demo:reset` | Delete **only** the known local demo database and uploads directory, then reseed. |
| `npm run dev` | Start API (4000) and Vite (5173) without touching data. |
| `npm run build` | Production client bundle + compiled server. |
| `npm start` | Run the compiled server (serves the API and the built client). |
| `npm run serve` | `demo:setup` + `build` + `start`. |
| `npm run lint` | ESLint 9 across client, server, shared and tests (zero warnings allowed). |
| `npm run typecheck` | Strict TypeScript for both the browser and server projects. |
| `npm run test` | Vitest unit + API integration suite. |
| `npm run test:e2e` | Build, seed an isolated `.e2e-data` workspace, run Playwright browser tests. |
| `npm run verify` | `lint` → `typecheck` → `test` → `build`. |

`demo:reset` refuses to touch anything outside `DATA_DIR`; it resolves the database and uploads paths and asserts containment before deleting.

---

## Architecture

```
shared/      Domain vocabulary and the pure calculation core (used by API *and* client)
  analytics.ts   budget rollups, readiness, health rules, deadlines, renewal exposure
  money.ts       integer-cent arithmetic and parsing
  dates.ts       timezone-aware "today", fiscal years, due classification
  csv.ts         RFC-4180 quoting + spreadsheet formula-injection defence
  permissions.ts capability matrix

server/      Express 4 API over SQLite (better-sqlite3)
  app.ts         middleware stack, route mounting, CSP
  auth/          bcrypt hashing, signed HttpOnly sessions, capability gates, CSRF
  db/            schema, migrations, deterministic demo seed (+ real PDF/XLSX evidence)
  lib/           errors, validation (zod), upload safety, activity log
  routes/        auth, grants, grant children, funders, workspace (dashboard/reports/team)
  services/      portfolio assembly, dashboard, calendar, reports, packet

client/      React 18 + Vite SPA
  components/    design-system primitives, dialogs, charts, app shell, command palette
  pages/         sign-in, dashboard, portfolio, grant detail, packet, funders,
                 calendar, reports, team, settings
  styles/        design tokens, base, layout, components, print
```

**Why this shape.** The calculation core is pure and shared, so the number on the dashboard, the number in the CSV, and the number in the unit test come from the same function. The server never trusts an organization id from the browser: it resolves membership from the session cookie and scopes every query and mutation to that tenant.

### Stack and version choices

Pinned for Node 20.11 compatibility (several current majors now require Node ≥20.19 or ≥22):

| Package | Version | Note |
| --- | --- | --- |
| `better-sqlite3` | 12.4.1 | v13 requires Node ≥22. Prebuilt binary loads on Node 20. |
| `vite` | 6.3.6 | v7/v8 require Node ≥20.19. |
| `vitest` | 3.2.4 | Pairs with Vite 6. |
| `express` | 4.21.2 | Stable middleware ecosystem. |
| `react` | 18.3.1 | With `@tanstack/react-query` 5 and `react-router-dom` 6. |
| `typescript` | 5.9.3 | Strict, `noUncheckedIndexedAccess` on. |
| `zod` | 3.25.76 | Validation at every mutation boundary. |

---

## How the numbers work

All of this lives in `shared/analytics.ts` and is covered by unit tests.

**Money is never a float.** Amounts are stored and summed as integer cents. User input is parsed straight from the decimal string to an integer — `parseAmountToCents('0.1') + parseAmountToCents('0.2') === parseAmountToCents('0.30')` exactly.

**Budget burn** compares spend against the *elapsed grant period*, not the calendar. A grant 41% through its period with 71% of its budget spent is 30 points ahead of schedule; that is what the UI says.

**Reporting readiness** scores only the reports you actually have to be ready for: open narrative/financial deliverables that are overdue, undated, or due within 90 days. Each is scored 65% on evidence coverage (attached ÷ required, capped) and 35% on progress (not started 0 / in progress 0.5 / submitted 1). A grant with nothing due in the horizon is 100% — there is no report to be unready for.

**Health** is a rule engine, not a score. Every rule emits a severity and a sentence:

| Signal | Severity | Fires when |
| --- | --- | --- |
| Deliverable past due | Risk | An open deliverable's due date has passed |
| 2+ tasks overdue | Risk | (1 overdue task is Watch) |
| Evidence gap, report ≤14 days | Risk | Required attachments missing close to the deadline |
| Evidence gap, report ≤30 days | Watch | Same, with more runway |
| Spending ahead of schedule | Risk | Spend exceeds elapsed period by >15 points |
| Budget burn behind schedule | Watch | Spend trails elapsed period by >15 points |
| Period ended, deliverables open | Risk | End date passed with obligations outstanding |
| Closeout ≤30 days, deliverables open | Risk | |
| Renewal window ≤90 days, unplanned | Watch | No renewal deliverable scheduled |
| Application deadline ≤14 days | Watch | Pipeline grant not yet submitted |
| No internal owner | Watch | |

A grant is **At risk** if any rule fires at Risk, **Watch** if only Watch rules fire, otherwise **On track**. Closed and declined grants report no open obligations.

**Renewal exposure** is the awarded value of active grants whose renewal decision (or period end, when no renewal date is recorded) falls inside the horizon — the money that must be re-won to stay flat.

**Fiscal year** follows the organization's start month, named for the year it ends in (a July start covering Jul 2026–Jun 2027 is FY2027). "Today" resolves in the organization's timezone, so a deadline does not flip over at 5pm local time.

---

## Permissions

Enforced server-side on every mutation via `requireCapability`. The client imports the same table only to decide which controls to render, so a Viewer never sees a button that would fail.

| | Owner | Manager | Member | Viewer |
| --- | :-: | :-: | :-: | :-: |
| View grants, funders, reports | ● | ● | ● | ● |
| Export CSV | ● | ● | ● | ● |
| Create / edit grants, tasks, deliverables, budgets | ● | ● | ● | — |
| Upload evidence, add notes | ● | ● | ● | — |
| Archive grants, manage funders | ● | ● | ● | — |
| Delete evidence | ● | ● | — | — |
| Manage team roles | ● | ● | — | — |
| Organization settings | ● | — | — | — |

Additional rules: a manager cannot change an owner's role or grant the owner role; an organization must always keep at least one owner; an owner cannot demote themselves while they are the only owner.

---

## Security posture (local demo)

- **Passwords** hashed with bcrypt (`bcryptjs`, cost 11). Sign-in returns an identical message for an unknown email and a wrong password.
- **Sessions** are opaque ids in an `HttpOnly`, `SameSite=Lax`, `Path=/` cookie, HMAC-signed with `SESSION_SECRET` so a tampered cookie is rejected before any database lookup. `Secure` is set in production and whenever HTTPS terminates at the trusted reverse proxy.
- **CSRF**: every non-GET request is origin-checked, and authenticated mutations must double-submit the session's CSRF token in `x-csrf-token`. Mutations are never exposed over GET.
- **Tenant isolation**: `org_id` comes from the session, never the request body. A foreign record id returns the same 404 as a nonexistent one, with no metadata.
- **Server binding**: loopback (`127.0.0.1`) by default — a machine running the demo does not expose it to the local network unless `HOST` is set deliberately. Demo account shortcuts require an explicit `DEMO_MODE=true` and are refused in production outright.
- **Uploads**: allowlisted by extension *and* declared MIME type (PDF, DOC/DOCX, XLS/XLSX, CSV, PNG, JPEG), 10 MB cap — and the *bytes are verified against the declared type*: PDF magic, real ZIP central-directory + mandatory OOXML parts for DOCX/XLSX, OLE magic for legacy Office, PNG/JPEG magic, and binary/markup rejection for CSV. A script renamed to `.pdf` or an arbitrary ZIP wearing `.xlsx` is rejected before anything is persisted. Filenames are sanitised for display; files are written under a generated, unguessable storage key inside a per-tenant folder. Path resolution asserts containment within the uploads root. The uploads directory is never statically served — downloads go through an authorised, tenant-scoped route that sets `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
- **Output safety**: notes and comments are stored and rendered as plain text (React escapes by default; no `dangerouslySetInnerHTML` anywhere). CSV exports quote per RFC 4180 and prefix formula-leading values so a funder-supplied name cannot execute in Excel.
- **Errors**: only curated `ApiError` messages reach the browser. Anything else is logged server-side and returned as a generic message — no stack traces, paths, or SQL.
- A restrictive Content-Security-Policy, `helmet` defaults, and a sign-in throttle (12 attempts / 10 minutes per IP+email) are on by default.

---

## Testing

```bash
npm run verify       # lint + typecheck + 255 unit/API tests + production build
npm run test:e2e     # 41 Playwright tests (desktop + 390px mobile)
npm run acceptance   # verify + the full browser suite from a clean deterministic seed
```

**255 unit and API tests** cover:

- money parsing, integer-cent arithmetic, formatting, weighted pipeline;
- date handling, timezone-resolved "today", fiscal years, due classification;
- budget rollups, readiness (including horizon and overdue behaviour), every health rule, next-deadline selection, renewal exposure;
- CSV quoting and formula-injection neutralisation, filename sanitisation, path-traversal refusal, upload allowlist;
- content-level upload verification with attack-style cases — text renamed to `.pdf`, non-ZIP bytes as `.xlsx`, a real ZIP that is not a workbook;
- lifecycle guards — no archiving live awards or grants with open work, no `CLOSED` with obligations, no `DECLINED` carrying an award — on both the full-edit and status routes;
- demo-account gating (hidden by default, visible only with `DEMO_MODE=true`, never in production);
- deadline tone classification against the session's real "today" (the Tasks-tab regression);
- board-view page-walking (complete portfolio, no drops or duplicates at page boundaries) and the packet's uncapped activity trail;
- authentication, session signing, CSRF and origin enforcement;
- the full permission matrix and Viewer mutation denial across 11 endpoints;
- cross-tenant isolation — reads, writes, child records, foreign owner/assignee/funder ids, and an attempt to override `orgId` in the body;
- persisted CRUD for grants, tasks, deliverables, budget lines, notes, funders and contacts, including persistence across a new app instance;
- upload/download/delete behaviour, size and type rejection, orphan-file avoidance;
- export correctness against the JSON reports;
- seed determinism and idempotency (same ids across independent databases; re-running changes nothing).

**41 Playwright tests** cover the owner journey (sign in → dashboard → create grant → task, deliverable, budget line, note, evidence upload → confirmed status change → reload persistence → reporting packet → CSV downloads → archive refusal with a stated reason → archive/restore of an eligible grant), Viewer read-only enforcement in the UI *and* via a direct API call from the page, keyboard/skip-link/dialog focus behaviour, the mobile drawer as a true modal (focus trap, Escape, inert background, unreachable when closed), the command palette's keyboard contract and loading/error states, record-name breadcrumbs, calendar month-grid semantics with the "+N more" disclosure reaching every event, agenda completeness past the old cap, honest board totals, labelled form controls, accessible chart summaries, and no horizontal overflow at 390px, 768px and 1440px.

---

## Accessibility and responsive design

- Semantic landmarks, one `h1` per page, skip link, visible focus rings.
- Dialogs trap focus, restore it to the trigger on close, and close on Escape. Menus support arrow-key navigation. Destructive confirmations start with focus on **Cancel**, and consequential changes (grant lifecycle, team roles) require an explicit confirm step.
- The mobile navigation drawer is a true modal: unreachable while closed, focus-trapped while open, closes on Escape or its close button, and returns focus to the trigger. The command palette follows the same contract, with honest loading/error/no-results states.
- Form hints and errors are programmatically associated with their controls (`aria-describedby`/`aria-errormessage`), and a failed submit moves focus to the first invalid field.
- The calendar month view is a real ARIA grid: full-date cell labels, weekday column headers, and a "+N more" disclosure button that reveals every event. Phones default to the agenda list.
- Status is never colour-only: every pill carries a text label and a shape. Small text meets WCAG AA contrast on every surface it sits on.
- Charts are `aria-hidden` and paired with a visible prose summary *and* a screen-reader table, so the data is never locked inside a picture.
- Scrollable tables and tab strips show edge shadows while more content is off-screen, so horizontal content is discoverable without a visible scrollbar.
- `prefers-reduced-motion` disables animation and shimmer.
- Verified with no horizontal overflow at 390px, 768px and 1440px.

---

## Configuration

Copy `.env.example` to `.env` to override. Every value has a safe development default, so the demo runs with no `.env` at all.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | API + production static server |
| `HOST` | `127.0.0.1` | Bind address. Loopback only by default — the workspace is never on the network unless you set this explicitly. |
| `DEMO_MODE` | *(off)* | Shows seeded accounts and the shared password at sign-in. Explicit opt-in, refused in production. Set by `npm run demo`/`npm run serve`. |
| `DATA_DIR` | `./data` | SQLite database and uploads |
| `SESSION_SECRET` | *(generated in dev)* | Cookie signing. **Required in production** — the server refuses to boot without it. |
| `SESSION_TTL_HOURS` | `72` | Session lifetime |
| `MAX_UPLOAD_MB` | `10` | Evidence upload cap |
| `ALLOWED_ORIGINS` | — | Extra origins permitted to send mutations |
| `SITE_URL` | `https://grantconsole.com` | Canonical origin for robots.txt / sitemap.xml |
| `GA_MEASUREMENT_ID` | *(off)* | GA4 id; the landing page ships Google's tag only when set |

`data/`, `.test-data/` and `.e2e-data/` are git-ignored; no secrets or runtime data are committed.

---

## Honest limitations

This is a local-first MVP. It is deliberately complete in the areas it covers and deliberately empty elsewhere.

- **No billing.** The pricing research supports a future $499/month plan; none of it is built.
- **No email.** No invitations, reminders, or digests. Team membership is seeded; there is no invite flow, and users cannot be created or deactivated from the UI.
- **No password management.** No self-service reset, change-password, or 2FA. The demo password is shared by design.
- **Single-process SQLite.** Fine for a team-sized workload on one machine; it is not clustered and there is no connection pool, read replica, or backup job.
- **Sessions are database rows**, not a distributed store. Restarting with a generated dev secret invalidates cookies.
- **Uploads are local files.** No virus scanning, no object storage, no content sniffing beyond the extension/MIME agreement — a valid-looking PDF is trusted to be one.
- **Reporting packets print from the browser.** The packet page is designed for print/save-as-PDF and exports to CSV; there is no server-side PDF renderer.
- **Search is substring matching** over titles, programs, funders and owners — no full-text index or fuzzy ranking.
- **Board view is a grouped read-only view.** Status changes happen through the labelled control on the grant, deliberately: drag-and-drop as the only way to change state is a keyboard-accessibility trap.
- **Activity metadata is not diff-level.** It records who changed what and the headline change, not a full field-by-field history.
- **Rate limiting is in-memory**, so it resets on restart and does not span processes.
- **One currency per organization.** Grants must use their workspace currency; there is no multi-currency portfolio or FX conversion.

### Before production

Set `SESSION_SECRET` and `NODE_ENV=production` (this enables `Secure` cookies and strict origin checks); put the app behind TLS; move sessions and rate limiting to a shared store; move uploads to object storage with server-side scanning; replace the seeded team with an invitation flow plus password reset and 2FA; add backups and a migration runner beyond the single bootstrap schema; and add structured request logging with a real error tracker.
