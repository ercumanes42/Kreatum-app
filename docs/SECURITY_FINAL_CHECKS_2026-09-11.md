# Final verification attempt: staging only

## Authorization and result

The user authorized tenant-isolation and full isolated-recovery verification before production publication. No production deployment, IAM mutation or relaxation of access protection occurred. The two checks are not complete.

## Tenant isolation: blocked before fixtures

After deployment of the corrected staging frontend, the existing normal-browser preflight was attempted once. Run `security-stage-mtxfuay2-6106d643b90bf9f3` started at 2026-09-11T20:58:09.772Z and stopped at 20:58:33.396Z with `appCheck/initial-throttle` in context `new-device`.

Evidence: `output/staging-security-smoke/security-stage-mtxfuay2-6106d643b90bf9f3.jsonl`. Zero security checks passed in this run; no accounts/workshops were created. No alternate identity, debug token, protection change or further retry was attempted. This is a test-attestation limitation, not proof that ordinary users or cross-tenant authorization fail. Existing local isolation tests remain distinct from live evidence.

## Full recovery: unavailable prerequisite

Read-only cloud inventory, independently reviewed and confirmed by the coordinator, returned five staging buckets: four Functions infrastructure buckets and the application bucket. No independent Storage backup destination was located in this project. The application bucket's `firestore-backups/` prefix lists four objects and no PDF/PPTX/JSON report artifacts; both listings completed without further pages. This is not an inventory of other projects or external backup systems.

`testIamPermissions` confirms the current identity can list objects but cannot read their bytes (`storage.objects.get` absent). No denied object download was attempted. The earlier six-object integrity test was performed under an explicitly authorized temporary binding, which was subsequently removed.

The previously restored database `security-restore-20260911` and verified existing report bytes are useful evidence but do not constitute restoration of independent report-file backups. Frontend `src/lib/firebase.ts` and backend `functions/src/index.ts` use the default Firestore database. Full application testing against the named restored database needs an isolated recovery deployment/configuration, not redirection of the running staging or production application.

Before proceeding, locate an authorized independent backup; if none exists, obtain approval for the bounded backup/recovery resources, possible cloud charges and required object-read access. A new copy taken now must not be described as proof of an older backup's recoverability.

## Release decision

Update: the subsequent user-authorized independent object copy and local data/report application recovery passed; see `SECURITY_ISOLATED_RECOVERY_2026-09-11.md`. The historical missing-backup prerequisite above is superseded for this bounded staging exercise. The live tenant check and broader release limitations below are not superseded.

Production remains blocked. In addition to these two unverified checks, the release control still requires `production-mfa`, which the user has deferred. That policy conflict requires an explicit decision; it must not be resolved by falsely marking MFA passed or silently removing the check. The full final release suite/artifact manifest and production compatibility review still apply before publication.

Completed staging evidence: `SECURITY_RECONNECTION_FIX_2026-09-11.md` (live closure/reconnection PASS), `SECURITY_STAGING_DEPLOYMENT_2026-09-11.md` (coordinated staging deployment and synthetic report downloads), and `SECURITY_ALERT_DELIVERY_2026-09-11.md` (all four staging receipts).
