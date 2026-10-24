# GrantConsole data-protection readiness and evidence

Prepared 25 October 2026. **Every item starts pending unless dated evidence is entered.** This is not a certification, signed DPA, adoption record or live deployment receipt.

## Operator decisions needed

- [ ] Confirm the exact contracting person/entity operating as Clear Anvil, its UK legal address, registration number if applicable, authorised signatory and appropriate customer-facing contact.
- [ ] Confirm every person with production, support, provider-console or backup access, their working country, legal relationship and confidentiality basis.
- [ ] Assign an accountable privacy/security lead, backup/restore owner, monitored urgent contact and alternate escalation route. Assess ICO registration/fee and DPO requirements as applicable; do not assume either is satisfied or mandatory without an assessment.
- [ ] Adopt finite end-of-service retention, customer export/deletion deadlines, diagnostic and incident-record retention, and backup/email-copy expiry based on technical feasibility.
- [ ] Accept the standard minimal-data scope. Keep sensitive beneficiary/health/safeguarding data outside it unless a separate review supports onboarding.

## Contract and supplier evidence

- [ ] Complete DPA party fields and Schedules 1–3, verify all security statements and have the authorised operator review the intended commitments. Obtain appropriate UK legal review for the actual agreement and use case before treating it as an approved contractual form.
- [ ] Confirm customer identity and authorised acceptance. Retain the accepted version, service agreement, instructions, security contacts and approved supplier schedule.
- [ ] Verify each provider's applicable DPA/terms and their incorporation/acceptance for the real account/entity. A new wet signature is not automatically required where terms are already validly incorporated; evidence of the actual arrangement is required.
- [ ] Verify provider legal entities, processing/access countries, subprocessors, change-notification subscriptions, retention/deletion and breach routes. Resolve shorter supplier notice than proposed customer notice.
- [ ] Complete restricted-transfer analysis per flow; verify adequacy scope or applicable transfer terms and required data protection test/TRA. Record approved remote-access countries. Do not create/sign a transfer instrument using guessed parties.
- [ ] Assess DPIA need, higher-risk scope and any required consultation. A completed DPA alone does not determine the customer's suitability or lawful basis.

## Technical and operating acceptance

- [ ] Record reviewed source version, deployed version and production verification separately.
- [ ] Verify deployed authenticator enrolment, confirmation before activation, login challenge, throttling, one-use recovery codes, safe factor disabling/reset, secret protection and session invalidation. Record whether 2FA is optional or enforceable; availability does not mean every account enabled it.
- [ ] Verify MFA and least privilege on Render, GitHub, email, Stripe and any backup provider; document exceptions. Application TOTP does not configure these accounts.
- [ ] Rehearse complete customer export including evidence files, verify tenant scope and protect the resulting package.
- [ ] Verify improved organisation erasure under success and filesystem-failure conditions, orphan identities, shared users, surviving references, tokens/sessions and local webhook records. Ensure logs do not unnecessarily retain deleted names/email/content.
- [ ] Verify scoped file deletion and database deletion results. Do not treat a successful HTTP status alone as proof all copies disappeared.
- [ ] Record application backup schedule, absolute paths, enabled/disabled status, key custody, destination region/provider, finite retention, pruning mechanism and alert recipient. Store keys separately from encrypted archives.
- [ ] Capture one actual scheduled backup success, confirm maximum age monitoring, and complete an isolated full database/upload restore. Record source/capture time, verification result and measured recovery time; suppress outbound jobs during restore.
- [ ] Establish an independent protected copy before promising recovery from loss of the production disk/account. Same-disk encrypted backups provide a useful recovery layer but not independent disaster recovery.
- [ ] Verify Render snapshot properties against the actual service/account, including deletion horizon and residence. Provider general documentation does not establish the account's restore outcome.
- [ ] Establish a deletion-tombstone process outside restored data and prove replay before re-enabling service after restore. Record backup/provider expiry and customer disclosure.
- [ ] Verify retention purges for contact/spam messages, email logs, diagnostics and customer end-of-service data. A privacy-page number needs an implemented recurring process.
- [ ] Adopt the access, incident and rights procedures; run a synthetic access-request, breach and erasure/restore tabletop. Record owners, dates, findings and fixes without customer data.
- [ ] Review the public privacy/security/terms pages and procurement draft against verified facts; remove unsupported supplier-agreement, backup, deletion, certification or UK-only-access claims.

## Evidence record template

| Item | State: draft / implemented / tested / deployed / operating | Evidence reference and date | Owner | Gap / next action |
| --- | --- | --- | --- | --- |
| Legal operator | Pending | — | Operator | Complete identity |
| Customer DPA | Draft | `customer-dpa.md`, 25 October 2026 | Operator | Complete, approve and agree |
| Supplier terms / transfers | Pending account verification | `suppliers-and-transfers.md` records public sources | Operator | Account evidence and assessment |
| Application 2FA | Pending separate implementation verification | — | Engineering | Test and production evidence |
| Backups | Pending separate implementation/operational verification | — | Operations | Schedule, independent destination, restore and alerts |
| Live erasure | Pending separate implementation verification | — | Engineering | Success/failure/shared-user tests and deployment |
| Operating procedures | Draft | `operating-safeguards.md`, 25 October 2026 | Operator | Adopt, assign and exercise |

## Safe procurement wording by evidence state

| Evidence available | Accurate wording |
| --- | --- |
| Draft contract only | “We have prepared a draft customer DPA for review; party details and schedules still need completion and agreement.” |
| Passing local tests only | “We have implemented and tested the feature locally; production availability is not yet confirmed.” |
| Feature deployed and checked | “Authenticator-based 2FA is available [optional/enforced as verified].” Do not imply universal enrolment. |
| Local encrypted archives + restore verified | “We have verified an application backup-and-restore procedure.” State schedule, storage and independent-copy limits explicitly. |
| Production schedule and independent restore evidenced | State the measured result and configured targets, date and scope; distinguish them from guaranteed RPO/RTO or an SLA. |
| Unknown provider/admin locations | “We are still confirming provider and support access locations and applicable safeguards; we cannot promise UK-only access.” |
| No independent certification | “We do not currently hold/publish SOC 2 or ISO 27001 certification.” Do not describe internal tests or supplier certifications as GrantConsole certification. |

Until the necessary items are evidenced, evaluation should use synthetic/example records. Updating an email draft must not convert pending work into completed assurances, and the draft must remain unsent unless the user later authorises sending.
