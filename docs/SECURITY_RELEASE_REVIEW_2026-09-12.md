# Security release review — 2026-09-12

## Scope

Final verification of the staging candidate, not a production deployment. Production is already serving customers. No production data, IAM, Rules, Functions or Hosting were changed during this review.

## Current verified evidence

- The guided staging disable-A / retain-B / reactivate-A UI flow is complete. See `SECURITY_MANUAL_TENANT_TEST_2026-09-12.md`. Screenshots do not independently establish fresh-login execution or the complete direct API/private-read matrix.
- Read-only inventories returned exactly the expected 70 ACTIVE functions in both production and staging, with no missing or unexpected endpoints.
- All 70 production functions use the dedicated production runtime account; App Check environment is false. All 70 staging functions use the existing default compute runtime account; App Check environment is true. A dedicated staging runtime account is not established by this evidence.
- A production organization metadata-only read returned one organization, with a valid canonical schemaVersion. No existing production organization was missing that field. This does not prove that the production provisioning handler includes the new fix.
- All four staging alert receipts and the bounded data/report recovery were verified previously. They were not repeated in this review.

## Dependency audit

Current npm audit reports no high or critical findings. Frontend has no reported findings; Functions has two moderate transitive findings (`gaxios` and `uuid`). The installed `gaxios` code calls `uuid.v4()` for multipart boundaries. The uuid advisory concerns buffer/offset handling in v3/v5/v6; this inspected call is not one of those methods. This limited reachability inspection is not proof that every dependency path is unaffected and does not close the findings.

Reference: https://github.com/advisories/GHSA-w5hq-g745-h8pq

## Validation record

The full diagnostic gate started at 2026-09-12T08:13:09.901Z with `node scripts/verify-release.mjs --full --allow-dirty`. The existing documented process-only Java TCP fallback was used for Windows emulators. No tests were intentionally filtered out.

The authoritative result is `tmp/release-evidence/release-manifest.json`. A running manifest marked `verification-incomplete` is not approval. `--allow-dirty` permits diagnostics only and cannot authorize publication. E2E output may target emulators: only verified final production builds may become release artifacts.

### Completed result

The gate finished at 2026-09-12T08:37:16.587Z. All ten technical checks passed with exitCode 0 and zero skipped tests: audit, verify (lint/typechecking/unit/Rules/build), integration, accessibility E2E, access/gameplay E2E, report E2E, load, migration, and both final production builds. Browser summaries: 12 accessibility tests, 16 access/gameplay tests, and one report-flow test passed. Load passed one test; migration passed 11. The gate process itself exited 1 because release eligibility is false, not because those technical checks failed.

The final production-target artifact tree hashes are:

- Frontend (29 files): `8092e5cd8e89d5d4dedc8d8d701cab490a050b27e15967b172b335a1ef9a69a7`.
- Functions (17 files): `e4265978055f7170b2741416db22c6850d899b4423a4c87ae94c34fd1b171da1`.
- Firestore Rules: `79373ed00c46f5e3fd31be7cc6b74a1811ad3435cddfafcb57ac6c85e13e7970`.
- Storage Rules: `9582f34a1f5acf9e4740e0804de68133ce57959743c22832a620823d8f6a3c0e`.

Local production preflight, explicitly targeting the candidate branch and requiring service accounts, confirmed all 70 endpoints, 67 primary-region and three scheduled-region entries, with no missing/wrong regions or mismatched/implicit runtime accounts. It failed only the dirty-worktree check and warned that this isolated candidate is not linked locally to Vercel. This is not a deployment or verification of the deployed frontend.

The release gate retains four blockers: unverified production MFA (user-deferred), incomplete live staging matrix, the broader recovery certification, and an uncommitted candidate. Existing changes were preserved; no commit, gate exception, production deployment or cloud permission expansion was made. Test emulators shut down after execution. `git diff --check` passed.

## Remaining boundaries

- The full live direct API/team-takeover matrix remains unverified after automated App Check rejection. No bypass or relaxation was attempted.
- MFA was explicitly deferred by the user; it is not passed. The current release policy still treats it as mandatory and therefore cannot yield an unconditional GO.
- Recovery evidence covers data and report files, not reconstruction of Cloud Auth/IAM and all infrastructure.
- Production alert-policy rollout and the post-publication observation window are not established by staging email receipts.

These limits must remain visible. Do not silently mark pending controls as passed, deploy demo artifacts, or label the platform completely secure.
