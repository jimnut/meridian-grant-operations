# GrantConsole operating safeguards

**Proposed procedures, 25 October 2026.** The operator must adopt these, assign monitored ownership and retain evidence before claiming they are established practices. Templates are not a historical access log, backup receipt or incident drill.

## Accountability and data boundaries

Assign one named privacy/security lead and a deputy or alternate escalation route. Record the legal operator, applicable registration/fee assessment, monitored security contact, supplier account owner and who can approve production access. Review this package quarterly and after incidents, major changes or a new supplier. Keep a processor record of processing: customers, authorised purposes/data categories, locations, suppliers, transfer basis, security measures and retention arrangements.

GrantConsole's default service scope is ordinary grant administration. Do not accept identifiable beneficiary casework, health records, safeguarding documents, children's records, criminal-offence information or identity documents under the standard draft. Use redacted evidence and aggregate programme figures. If such material arrives, restrict access, tell the customer privately, and agree secure removal or a separately assessed and authorised scope. Do not copy it into tickets, analytics, developer tools or external AI systems. The public demo must contain synthetic data only.

## Production and support access

Before granting access, create a record with person, employment/contract relationship, confidentiality basis, privilege, approved country, purpose, approver, start and expiry. Use individual identities and least privilege. Verify MFA on production hosting, repository, email and payment accounts where supported; app-user 2FA does not establish provider-console MFA. Keep production secrets in the hosting secret store or approved secret manager; prohibit credentials and live datasets in source control or ordinary support email.

For customer support:

1. Confirm the request came from an authorised workspace contact without requesting passwords, authentication codes or recovery codes.
2. Try synthetic reproduction or a redacted screenshot first. Obtain written permission specifying workspace, issue, data needed, person accessing, country, time window and permitted actions before accessing customer content.
3. Check the permission and country against the agreed DPA/transfer schedule. A message saying “please help” is insufficient for unrestricted database browsing.
4. Use the narrowest available read or change. Do not download the whole multi-tenant database for a single support issue. Copy no customer content to a personal device, unapproved service or external model.
5. Record access time, scope, material changes, outcome and permission reference. Close temporary permissions and delete authorised diagnostic extracts after the agreed task.

Do not promise that infrastructure admins are technically unable to access data: the current architecture does not establish such a barrier. Routine customer content access requires permission. A narrowly necessary emergency response to protect data/service may proceed only under the accepted DPA's documented security instructions, with an incident record, minimal scope and prompt customer notice unless prohibited by law. Record the reason when prior permission was not practicable.

Review privileged access quarterly and immediately on role departure. Remove expired access, revoke sessions/tokens and record closure. Do not claim an automated privileged-access system or immutable support audit trail until implemented and verified.

### Access record template

`ticket | customer/workspace pseudonymous reference | authorised requester | written permission reference | operator | employment/contract relationship | access country | privilege/purpose | approved start/end | actual start/end | actions | extracts/location/expiry | closure reviewer`

## Breach response

Use this procedure for suspected loss, unauthorised access/disclosure, corruption or material unavailability of personal data. Contact-form abuse alone is not evidence of mailbox or customer-data compromise, but it should be assessed if facts indicate unauthorised disclosure or access.

1. **Triage immediately.** Record discovery and awareness times separately in UTC, reporter, affected systems, suspected scope and initial incident lead. Preserve useful logs without duplicating unnecessary personal content. Contain safely: revoke a compromised token/session, isolate affected access or stop risky processing. Do not destroy evidence or erase production data as a shortcut.
2. **Identify roles and affected customers.** Determine whether GrantConsole processes affected information as processor or controller; record affected categories/people, approximate counts, availability/integrity/confidentiality impact and uncertainties. A supplier incident may affect several customers.
3. **Notify customers without undue delay on becoming aware of a breach of their data.** The proposed internal goal is an initial contact within 24 hours, sooner where practicable; this is an operating target to adopt and test, not an existing contractual SLA. Do not wait for a root-cause report. Use verified security contacts, provide known facts, mitigations and next update time, and continue with phased updates.
4. **Assess statutory reporting separately.** As processor, assist the customer controller's decision; do not decide that its notification duty is absent. For information where the operator is controller, assess risk and notify the ICO without undue delay and, where feasible, within 72 hours when required; inform affected individuals without undue delay where required by the high-risk threshold. Record reasons for a decision not to notify. Get relevant expertise for uncertain decisions without delaying required notice.
5. **Recover and review.** Validate fixes, replay deletion instructions before restored data returns to service, monitor recurrence, and document causes, consequences, corrective actions, owners and due dates. Retain the restricted incident record only as long as justified by accountability and claims needs, with annual review; do not preserve an unrestricted duplicate of the exposed dataset.

### Customer initial-notice template

“We became aware at [time UTC] of a personal data breach affecting [service/workspace]. We currently know [facts, categories and approximate scope]. We have [containment], and anticipate [known risks]. We are still investigating [uncertainties]. Your incident contact is [person/monitored address]. We will update you by [time]. Please use [secure channel] for sensitive follow-up.”

Never put credentials or sensitive affected records into a bulk incident message. Validate the recipient list independently before sending.

## Individual rights and controller instructions

Log requests on receipt, verify identity/authority proportionately, identify whether the operator is controller or processor, and assign the statutory/customer deadline. As processor, promptly forward to the authorised customer contact; do not confirm a person's presence in another organisation's workspace or fulfil a destructive request without authority. Proposed operating targets are acknowledgement within two working days and a first internal action within five; these do not extend the controller's legal deadline.

Assist by locating relevant scoped records, producing a secure export, correcting/erasing/restricting authorised information and identifying supplier copies. Verify the export contains no other tenant's information. Give it only to a validated recipient through a suitably protected channel, with an expiry. Retain minimal proof of the request and action, not a permanent copy of the export. Record any legal exception and review date. Where the operator is controller, provide the applicable statutory response or permitted extension with reasons; a standard response timer alone does not establish compliance.

## Retention, return and erasure

The current public product model retains ended trials/subscriptions in read-only form until an owner deletes the organisation. This is not a finite inactivity policy. Before accepting a customer's DPA, agree a finite end-of-service export/deletion window or a specifically agreed retention instruction, implement the necessary process and explain the retention transparently. Do not silently auto-delete accounts under a new policy without appropriate authority and notice.

| Record class | Current review finding / required action |
| --- | --- |
| Workspace grants, notes, activity and evidence | Customer-directed retention while service continues; owner deletion exists. Test full export and verified erasure before promising a fixed completion time. Archive is not erasure. |
| Orphan user identities | Initial source review found deactivation rather than identity erasure after organisation deletion. A separate fix is in progress; verify deployed handling. Preserve legitimate shared-user membership in other organisations. |
| Deleted uploads | Initial code swallowed filesystem failures. A separate fix is in progress; completion must depend on verified file removal, with retry/failure records. |
| Application backups | Complete configured maximum age and pruning proof from the backup runbook. Same-disk backups do not survive loss of the source disk. Record independent destination and key custody if enabled. |
| Render snapshots | Provider documents automatic daily snapshots available for seven days after creation; actual maximum lifetime, snapshot location and account controls need evidence. Do not guarantee erasure by day seven without that evidence. |
| Transactional email and delivery logs | Inspect Resend account settings, recipients, retention and deletion route. Content can include organisation, grant and task/deadline titles as well as authentication links; do not describe it as email addresses only. |
| Billing | Keep separately justified statutory business/accounting records under restricted access; identify actual legal basis and retention. Do not retain raw webhook payloads solely on an assumed accounting requirement. Stripe's own lawful records are subject to its role/terms. |
| Public contacts | Public notice states up to two years. Verify a recurring purge is configured, covers spam/quarantine entries and includes backups/provider copies; manual intention is insufficient. |
| Operational logs and diagnostics | Inventory actual hosting/app logs, their personal fields, retention, provider locations and deletion controls. Avoid recording content, tokens and excessive identifiers. No blanket claim of anonymisation. |

### Controlled workspace erasure

1. Verify the owner/instruction and scope. Offer full records export plus uploaded files before deletion when requested. Confirm what remains for other memberships or legal obligations.
2. Record a minimal erasure instruction/tombstone in a restricted record independent of restorable backups: workspace reference, deletion time, scope, confirmation reference, latest possible copy expiry. Do not store a duplicate dataset in this record.
3. Remove scoped live files and records using the verified deletion mechanism. Check errors; retry failure safely. Verify database absence, file absence, session invalidation, shared-user treatment and supplier records as applicable. Mark **live removal complete** only after checks.
4. Block any pending backup/snapshot copies from ordinary use. Record every backup class and latest expected expiry; establish supplier deletion requests where needed. On restore, apply outstanding tombstones before enabling logins, exports, notifications or background jobs.
5. At expiry, check purge evidence and close **all copies complete**, or disclose documented legal exceptions. Tell the customer precisely which stage completed. Keep no promise of immediate deletion from every supplier backup unless independently supported.

### Deletion record template

`instruction reference | authorised requester | scope | export requested/completed | live removal time and checks | failed steps/retry owner | shared identity treatment | provider requests | backup classes/latest expiry | restore tombstone reference | legal exceptions/review | final confirmation`

### Backup operating acceptance

Before enabling a recurring job, verify SQLite-consistent capture and a recoverable relationship between database references and uploaded files; ensure neither uploads nor transactions change under an uncoordinated copy. Capture configuration needed to recover, with secrets protected separately. Encrypt and restrict backup access; verify independent storage if claiming disaster recovery. Set finite retention, scheduled pruning, failure alert recipient, maximum backup age and an owner who checks it. Test a full isolated restore and representative downloads without production email/payment jobs. Record measured recovery time and the newest recovered record; do not promise RTO/RPO until a feasible schedule and restore support them.

Proposed cadence to adopt: check last-success/age and errors daily, perform an isolated restore monthly and after material schema/storage changes, and review the complete recovery procedure quarterly. A synthetic local restore proves the procedure can work in that test; it does not prove live scheduling, independent copies or recovery from a provider loss.

## Review basis

- [ICO data-security guide](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/security/a-guide-to-data-security/): assess controls and recovery against actual risk.
- [ICO personal-data-breach guide](https://ico.org.uk/for-organisations/report-a-breach/personal-data-breach/personal-data-breaches-a-guide/): processor notice, controller reporting and incident records.
- [ICO erasure guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/): scope and backup handling.
- [NCSC recovery capability](https://www.ncsc.gov.uk/collection/disruptive-cyber-attacks/preparing/3-prepare-technical-recovery): protected backups and recovery testing.
- [Render persistent-disk documentation](https://render.com/docs/disks): provider disk and snapshot properties; not production-account verification.
