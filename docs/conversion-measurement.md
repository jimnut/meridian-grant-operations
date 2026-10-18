# Conversion measurement and billing setup

The internal ledger records successful workspace creation, a saved nonsample
award/reporting workflow, and the first verified positive invoice payment. It
does not establish lead qualification, validate entered grant data, or calculate
net revenue. Classify internal/test accounts with the protected admin endpoint.
Historical signup/activation dates are not inferred or backfilled.

## Stripe preflight

Confirm the actual webhook endpoint API version and enabled event list in Stripe
before release. The deployment's current version has not been verified. Retain
the existing checkout/subscription/invoice-failure events and explicitly enable
`invoice.payment_succeeded`, `invoice.paid`, relevant `refund.*`, `charge.refunded`
and `charge.dispute.*` events supported by that endpoint. Test signatures, replay,
late account linkage and event ordering in staging. No account setting is changed
by the code or this document.

Stripe distinguishes a successful invoice payment attempt from an invoice simply
marked paid, which can include out-of-band settlement. The ledger requires live
mode, positive `amount_paid`, and invoice status `paid`, plus either:

- `invoice.payment_succeeded` processor evidence; or
- legacy `invoice.paid` with explicit `paid=true` and `paid_out_of_band=false`.

Explicit external-payment indicators exclude the invoice from this payment
conversion. A modern `invoice.paid` without processor evidence is retained as
`invoice_unverified`, even if `status=paid` and the amount is positive. A later
successful-attempt event resolves its reporting ambiguity. Zero, test-mode,
unknown-mode and not-fully-paid invoices do not create a paid conversion. Sandbox
testing should verify fact receipt and exclusion, not production customer counts.

[Stripe event definitions](https://docs.stripe.com/api/events/types) document the
difference between the two events. The [Basil change](https://docs.stripe.com/changelog/basil/2025-03-31/add-support-for-multiple-partial-payments-on-invoices)
removed the invoice `paid`, `paid_out_of_band`, `charge` and `payment_intent`
fields, and changed `amount_paid` to include external payments. Do not restore a
dependency on those legacy fields for modern successful-payment events.

Refund/dispute facts retain status separately from historical first-paid status.
They are not summed with cumulative charge-refund totals. Modern invoice payment
intent correlation uses a single unambiguous `payments.data.payment.payment_intent`
reference when supplied. Multiple or missing references may remain unlinked;
the report marks those unresolved records. There is no automatic Stripe lookup,
and the report must not be described as fully reconciled net revenue. Verify
actual emitted shapes against the endpoint version. Stripe's [invoice payments
reference](https://docs.stripe.com/api/invoice-payment/object) describes these
relationships.

## Public analytics and attribution

Google Analytics is loaded only on public marketing pages. App, signup, signin,
invitation and private workspace pages never load it. Public pages remove query
strings and fragments before loading the tag; an existing anchor still scrolls
into view. The explicit event payload uses a public path, constant site title,
and origin-only referrer. `cta_click` contains fixed destination/placement enums;
`generate_lead` requires an accepted one-use contact receipt. It is a submission,
not a qualified prospect. Direct, refreshed, duplicated, expired, honeypot and
flagged thank-you visits do not produce that event.

Disable Enhanced Measurement in the matching GA4 web stream so automatic form,
history, download and outbound-link events cannot bypass this field contract or
duplicate the explicit events. Leave email redaction enabled. Do not recreate
signup/activation/payment events from URL visits, checkout return parameters, or
GA event rules. The internal ledger is the source for these milestones. Browser
privacy settings and blockers can suppress public analytics, so GA totals are
not expected to equal stored submissions.

DNT=1 and Global Privacy Control suppress the public tag and acquisition cookie.
The first-party cookie is signed, HttpOnly, SameSite=Lax, Secure in production,
and expires after 30 days. It contains only a coarse first-observed channel,
known public landing path and timestamp; no visitor identifier or search terms.
Paid-click markers are excluded from Google organic. Missing or unverifiable
referrers remain unknown. This is coarse first-observed attribution, not an
identity-linked cross-device or multi-touch attribution model.

## Operator reporting

Use the existing ADMIN_TOKEN bearer protection over HTTPS; never put the token
in a URL, document, browser console or screenshot. These paths are available:

- `GET /api/admin/conversions`: aggregate milestones and mature cohorts.
- `PATCH /api/admin/conversions/quality`: body `organizationId` and `quality`
  (`unreviewed`, `qualified`, `spam`, or `internal_test`).
- `GET /api/admin/leads`: review stored submissions with quality status.
- `PATCH /api/admin/leads/quality`: body `id` and `quality` (`unreviewed`,
  `flagged`, `qualified`, `spam`, or `internal_test`).
- `GET /api/admin/leads/summary`: counts by quality.

Review qualification manually against an actual nonprofit/team need, not a
search rank, sample data or submission count. Historical rows start unreviewed.
Automatic bot detection only flags the narrow repeated opaque-name pattern;
other spam can still arrive. HMAC-based duplicate suppression lasts 24 hours and
survives restart; the existing per-IP hourly throttle remains in memory.

Review seven-day activation only for trials at least seven days old, and
30-day paid conversion only for trials at least 30 days old. Keep unreviewed and
qualified cohorts separate. Compare public page/query clicks and CTR after a
full 28-day observation window without claiming causality from small samples.
Existing billing entitlement updates still follow webhook delivery order; this
measurement change does not claim to repair all stale subscription transitions.

## Release and rollback

Migrations add columns/tables/indexes without dropping old data. The baseline
schema migration test checks existing rows, explicit-column writes and evidence
files survive repeated migration. Keep a recent platform backup and deploy the
reviewed Git commit. After deploy verify public pages, app CSP, downloads,
sitemap dates, direct thank-you visits and service health. Real payments must be
tested through Stripe's appropriate test environment, not by manufacturing a
production customer or charge.

Code rollback to the previous revision can keep the additive database fields.
Do not restore an older disk snapshot unless intentionally accepting the loss
of writes made after it. Never run `demo:reset` or `e2e:seed` against production:
those commands replace the configured database/uploads. Normal `demo:setup`
without `--force` preserves customer records; it only adds demos if absent.
