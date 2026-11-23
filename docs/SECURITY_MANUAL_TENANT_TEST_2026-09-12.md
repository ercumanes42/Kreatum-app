# Guided staging tenant test - 2026-09-12

## Latest manual result

Subsequent user screenshots confirm B history renders without a permissions error while A remains disabled, followed by A history rendering without an error after facilitator reactivation. The organization panel shows one contracted/available and zero used workshops. This completes the observed manual disable/retained-B-access/reactivate flow for these staging fixtures. It does not independently prove a fresh authentication event or direct API/Rules attack rejection against the live service; keep the broader matrix pending. No need to repeat these completed UI steps.

## Scope and observed baseline

The user created `security-test-a-20260912` and `security-test-b-20260912` through the staging platform UI, each with one workshop allowance, and accepted both invitations using the authorized secondary account. Screenshots show each organization selected and its home view rendered. This is UI baseline evidence, not proof of backend isolation. No workshop creation was requested.

Creating an organization with zero allowance was rejected. Source confirms the frontend currently accepts zero but the server requires at least one; the user used one. This validation inconsistency is separate from the security test.

## Confirmed deployment gap

The attempted facilitator deactivation in test A displayed a generic error and the UI still showed an active facilitator. No successful deactivation is claimed. Read-only Cloud Functions inventory returned 69 staging functions and no `changePlatformFacilitatorStatus` endpoint. The frontend invokes that exact callable, which is exported by the local backend and required by the release inventory. The targeted service log query returned no entries in the last 24 hours. The missing deployed endpoint explains why this UI operation cannot complete in this environment; it is not evidence of failed tenant-scoped authorization inside the handler.

## Validation and containment

Before selective publication: lint passed, backend TypeScript checking passed, backend unit suites passed 61 plus 6 tests with zero skipped, and the staging Functions build passed. No product source changes were necessary to supply the existing missing endpoint.

A preliminary manifest lacked an explicit runtime account; a safety check stopped that attempt. Readback of the existing staging `changeMemberStatus` function identifies the default compute runtime account, and the proposed dedicated staging account does not exist. The final manifest uses the existing staging runtime account, not a new or differently privileged identity. App Check remains enabled. No IAM grant, Rules change, Hosting publication or production action is authorized by this bounded correction. Dedicated-runtime hardening in staging remains a separate unverified control; earlier generic assertions of a dedicated staging account must not be used as evidence.

## Completion criteria

Selective deployment completed successfully. Cloud readback confirms `changePlatformFacilitatorStatus` ACTIVE, Node.js 22, revision `changeplatformfacilitatorstatus-00001-pas`, update time `2026-09-12T07:52:04.251164730Z`, App Check environment `true`, and the existing staging compute runtime account. The bundled source SHA-256 is `866103158581e18d1752e205d3ceb394fa084f7f4ead37779e5cf144723b43d8`. No functional retry by the user has yet been verified.

The selective deployment must be followed by readback of the missing function in ACTIVE state and verification of runtime account and App Check environment. The guided test must then demonstrate: A deactivation succeeds, A access is rejected, B access still succeeds after refresh and fresh login, and A reactivation succeeds. UI evidence alone does not complete the broader API/Rules cross-tenant matrix. Do not mark the release gate passed on deployment alone.

## Guided retry and independent provisioning defect

Subsequent user screenshots show successful tenant A facilitator deactivation and removal of A from the selector, while B remains selectable. The user was then asked to sign out, sign in again and open B history; the supplied screenshot shows B selected and a permissions error in history. This is not a successful history-access check and does not prove that the requested sign-out sequence occurred.

Read-only staging checks confirmed the authorized secondary Auth account is not globally disabled. Its member and membership-index records are both disabled in A and both active/facilitator in B. Both organizations have active, timestamp-based commercial periods, but both lack `schemaVersion`. Deployed Firestore Rules match local source and explicitly require an integer schemaVersion >= 2. Actual platform provisioning source sets platformSchemaVersion only; this is a separate field and cannot satisfy Rules.

An isolated test executing the actual provisioning handler reproduced the missing version before the fix (undefined instead of 2). The localized fix imports SCHEMA_VERSION and writes schemaVersion on organization creation. After correction, lint, backend TypeScript, 62 backend unit tests plus 6 supplemental tests, and the staging Functions build pass. All 22 Rules tests pass, including the exact empty history query with organization/facilitator filters, createdAt ordering and limit: missing-schema B is denied; repaired active B succeeds; disabled A and an unscoped B query remain denied. An initial emulator startup failed due to the documented Windows Java Unix-socket issue; the successful run used the existing process-only TCP fallback and shut down cleanly. No Rules were weakened or deployed.

Only the two explicitly named staging test organization documents were repaired in a transaction by adding schemaVersion=2. Guards checked their expected names, active status, platform schema and valid commercial periods. Readback verified all other organization fields unchanged. No membership, real organization or production document was changed. The future-provisioning function was selectively updated; its bundle SHA-256 is 6288513e5c10c90a726f9af7f031459572f734e36599aef4dfcd8b6725cdd423. Readback confirms ACTIVE, revision provisionorganizationandinvitefacilitator-00004-nop, update time 2026-09-12T08:04:40.235388858Z and App Check enabled, with the existing staging runtime account. Live B-history retry and A reactivation remain pending.
