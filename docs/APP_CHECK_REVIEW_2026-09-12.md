# Production App Check review — 2026-09-12

Project: `kreatum-dinamic`. Read-only review. Window: 2026-09-11T06:31:35.608Z through 2026-09-12T06:31:35.608Z. No deployment, IAM edit, token bypass or enforcement change.

## Evidence

- Cloud Functions v2 inventory complete: 70/70 ACTIVE, all 70 using the dedicated `kreatum-functions-runtime` account. All 70 expose `KREATUM_ENFORCE_APP_CHECK=false`. This is configuration readback, not a synthetic enforcement test.
- App Check metrics `resources/verification_count`, `services/verification_count` and `services/verdict_count` each report 3 VALID/ALLOW events. These are separate views and must not be summed as nine requests. All listings complete.
- Callable verification logs: 5 entries, 2 VALID and 3 MISSING App Check tokens. Observed services: listMyOrganizations (3), changeMemberStatus (1), getReportJob (1). Counts by service and token status were aggregated separately; no claim assigns a token status to a particular service. This small sample does not cover all critical flows or demonstrate representative traffic.
- Project-wide logs at severity ERROR or higher: zero entries in the specified window, complete query. This does not prove absence of all application failures.
- Six Storage buckets all have UBLA enabled. Application and release-backup buckets explicitly enforce PAP. The four technical Functions buckets report inherited PAP; effective organization-policy enforcement was not verified. IAM readback on all six shows zero public-member bindings.

## Decision

NO-GO for enabling App Check enforcement: insufficient representative traffic and observed tokenless callable requests. The three valid metric events are not evidence of complete client coverage. Existing false settings were left unchanged; Firestore/Storage were not modified. No staged enforcement rollout was started, so no new rollout or rollback action is required.

This routine observation does not resolve the separate live tenant-isolation preflight or approve publication of the security candidate. Continue the existing monitor quietly unless there is a material change requiring attention.
