# Remaining security validations: execution attempt

Checked at 2026-09-12 10:46 UTC. Scope: the user's request to execute the two remaining validations; no production mutations and no MFA activation.

## Cross-organization validation

- Local runner guard tests: 20 passed, 0 failed, 0 skipped (`node --test scripts/staging-security-smoke.test.mjs scripts/staging-browser-transport.test.mjs`). These validate the test harness, not deployed tenant isolation.
- Executed `node scripts/staging-security-smoke.mjs --project kreatum-dinamic-staging --execute`.
- Normal staging App Check attestation rejected the first browser context before fixture creation: HTTP 403, `appCheck/initial-throttle`, context `owner`.
- Result: 0 live security checks passed; no synthetic fixtures created. No retries using alternate credentials, debug tokens, or disabled protections.
- Evidence: `output/staging-security-smoke/security-stage-mty9dvd2-7ff2455ce80866f3.jsonl`, started 10:45:11 UTC, stopped 10:45:31 UTC.
- Authorized readback of Auth and App Check configuration succeeded. Password sign-in is enabled and the Enterprise provider is configured. This does not establish why attestation rejected the automated browser.
- Earlier guided disable-A/retain-B/reactivate-A evidence remains valid within its narrower scope; it does not replace the blocked direct API/device-takeover checks.

## Full cloud recovery

- Read-only inventory confirms staging's default database and `security-restore-20260911` still exist, along with the independent backup and restore buckets documented in `SECURITY_ISOLATED_RECOVERY_2026-09-11.md`.
- Staging has seven READY Firestore backups; latest snapshot: 2026-09-11T23:25:04.757852Z. Availability is not proof of restoration.
- Prior evidence verifies nine independent object copies and local application recovery of 395 records and six report downloads. Those tests were not rerun or relabeled as full cloud recovery.
- Existing recovery scripts deliberately do not restore Cloud Auth or cloud IAM. No verified end-to-end reconstruction procedure for those components was found in the searched scripts and documentation.
- No dedicated KREATUM full-cloud recovery project appeared in the accessible project inventory. Other unrelated projects were not inspected or used.
- Reconstructing identities and project-wide permissions in current staging would affect that shared environment. A separate temporary Google Cloud project, its billing and tightly scoped IAM require explicit scope approval before this broader exercise.

## Outcome

Both broad controls remain pending. Production, MFA, App Check enforcement, existing identities, IAM and published artifacts were not changed. This attempt does not justify a complete-security certification or a release-gate override.
