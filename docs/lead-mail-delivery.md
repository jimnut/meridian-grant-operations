# Hosted lead acknowledgements and delivery recovery

New accepted contact/pricing enquiries and their two mail envelopes commit in the
same SQLite transaction. One envelope acknowledges receipt to the visitor; the
other alerts `LEAD_NOTIFICATION_EMAIL`. The acknowledgement identifies itself as
automatic. It is not a substantive answer to the enquiry and does not promise a
human response time. Suspicious or rate-limited enquiries remain quarantined and
do not create outbound jobs. Migration does not enqueue historical leads.

The hosted Node server starts the worker at boot and checks due jobs every 30
seconds. Render must be running with its persistent disk attached; Codex and the
owner's computer are not involved. The public request also triggers a fast first
attempt after committing. A provider outage does not lose the accepted enquiry.

## Quotas and retries

The free Resend plan still has its normal provider limits. This change does not
increase the allowance, purchase a subscription or bypass it. On a daily quota
error, the worker persists a pause until the next midnight UTC plus one minute,
honouring a longer `Retry-After` if provided. Monthly quota errors pause for at
least a day before rechecking. Rate limits and transient failures use exponential
backoff. A persisted pause survives a restart. If the limit remains exhausted,
the provider rejects the next attempt and the worker defers again.

Every envelope freezes From, Reply-To, recipient, subject, bodies and its unique
provider idempotency key. Successful jobs are not retried. Independent workers
claim jobs with atomic SQLite leases; stale workers cannot overwrite newer
claims. The HTTP timeout is ten seconds, shorter than the one-minute lease.
Resend retains idempotency keys for 24 hours. An ambiguous request or abandoned
claim older than 23 hours stops in `uncertain` for operator review instead of
risking a duplicate outside that retention window. Permanent payload errors stop
in `failed`. Do not blindly reset `uncertain` jobs: inspect provider receipts first.

`sent` means the provider accepted the request. It does not prove inbox delivery,
reading, interest or that the team has answered the question. Bounces and provider
suppression still require normal operational review. Replying directly to an
existing GrantConsole email or to its Gmail alias is separate from this public
form pipeline; this worker does not read or automatically answer Gmail threads.

## Holds and status

Set `LEAD_REPLY_HOLD_EMAILS` to comma-separated addresses before deployment when a
recipient must not be contacted. The worker persists these holds before claiming
mail. Removing the setting does not release a persisted hold. There are no real
customer addresses in the source tree. Holds suppress queued mail to the held
recipient, including future enquiries, while retaining the record. A hold cannot
recall a request already submitted to the provider.

Existing owner-token authentication protects these endpoints:

- `GET /api/admin/lead-mail`: status counts, provider pause and the latest 100 job
  receipts, without the stored enquiry bodies or credentials.
- `GET /api/admin/leads/reply-holds`: current persisted holds.
- `POST /api/admin/leads/reply-holds`: `{ "email": "held@example.org", "reason":
  "Explicit owner hold" }`.
- `DELETE /api/admin/leads/reply-holds`: `{ "email": "held@example.org" }`, only
  after removing an environment-configured hold and obtaining the owner's release.

Never print the owner token or mail API key. To check status in the authorized
Render Web Shell, use `process.env.ADMIN_TOKEN` only in a request to the service's
own admin endpoint, rather than copying the credential into chat or local files.

## Release verification

Before deploying, verify tests for queue persistence, quota pauses, partial
success, concurrency, holds, spam suppression, idempotency and the hosted ticker.
Retain `EMAIL_REPLY_TO` and `LEAD_NOTIFICATION_EMAIL` at the verified GrantConsole
inbox. Preserve existing MFA and backup settings. After deployment, submit one
identified owner test, confirm two outbox jobs, and inspect the provider pause
without forcing an early retry. After quota recovery, verify the provider receipts
and the actual two inbox messages. Historical spam must never be bulk queued.

Provider references: [Resend errors](https://resend.com/docs/api-reference/errors)
and [idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).
