# GrantConsole data-protection package

Prepared 25 October 2026. **Draft for operator and customer review; not executed, adopted or evidence of compliance.**

This package separates a proposed customer contract from operating procedures and the evidence needed before making customer assurances. Clear Anvil has been described by its operator as UK based. Its contracting legal identity, address and access locations are not yet confirmed. Do not infer those details from a domain name.

## Documents

- [Customer DPA](customer-dpa.md): proposed Article 28 terms, party/signature fields, processing schedule and security schedule.
- [Operating safeguards](operating-safeguards.md): support access, incidents, rights, retention and erasure procedures with evidence records.
- [Suppliers and international access](suppliers-and-transfers.md): actual data flows, supplier evidence and a transfer assessment worksheet.
- [Readiness checklist](readiness-checklist.md): decisions and verification needed before using the DPA or giving procurement answers.

The proposed DPA becomes usable only when its party fields and schedules are completed, the listed controls are verified and accepted, and an authorised person for each party agrees to it. A draft customer DPA does not itself bind suppliers, establish a UK international-transfer mechanism or prove that backups are operating. Public supplier terms are evidence of an available contract, not proof of the operator's applicable account agreement.

## Handling these records

Keep a dated final DPA and its accepted schedules for each customer in a restricted contract record, alongside their documented instructions and authorised contacts. Keep supplier-account acceptance records, access lists, incident records, backup results and deletion evidence in a restricted operations record. This repository should contain templates and synthetic examples only: do not commit customer records, credentials, recovery codes, encryption keys or confidential supplier reports.

The initial technical review used `server/lib/site.ts`, `server/routes/workspace.ts`, `server/lib/mailer.ts`, `server/lib/scheduler.ts` and the app's documented single-process SQLite architecture. Hosting information supplied for this review places the application, SQLite database and uploads on a Render persistent disk in Frankfurt at `/var/data`. Independently retain dashboard evidence for the actual production service, disk region and configuration before treating this as a contractual hosting assurance.

Two-factor authentication and application backup work were being implemented separately when this package was prepared. Implementation, test success, production deployment and operational monitoring are distinct facts. Record each separately in the readiness checklist; this package does not assume any of them has happened.
