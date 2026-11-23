# Authorized isolated recovery — 2026-09-11

## Scope and authorization

The user explicitly approved an independent backup and a temporary isolated recovery environment in staging, minimum temporary access, and possible Google Cloud costs. Production, existing workshops, original report artifacts, global identities and App Check protections are outside this mutation scope.

This is a new copy taken today. It does not demonstrate that an older, independently scheduled report backup was recoverable, nor certify Cloud Auth/IAM disaster recovery.

## Private resources

- Project: `kreatum-dinamic-staging` (`829452780690`).
- Location: `EUROPE-SOUTHWEST1`.
- Backup: `kreatum-stg-backup-20260911-c08283a8481a41609092de7d`, created `2026-09-11T21:11:51.426Z`.
- Restore: `kreatum-stg-restore-20260911-a9ebbfdae3ac496cb3ff4353`, created `2026-09-11T21:11:52.315Z`.
- Both use uniform bucket-level access and enforced public-access prevention. Object lifecycle deletion is seven days; seven-day soft deletion can extend billable retention. Empty buckets are not automatically removed by that lifecycle.
- Source inventory completed: 9 current `organizations/` report objects, 15,417,725 bytes. Deleted versions and other prefixes are not included.
- Temporary IAM is restricted to exact objects and expires within 55 minutes. Each run removes its own bindings using fresh etags and verifies removal.

## Implementation and local validation

`scripts/staging-storage-recovery.ps1` supports read-only check, fresh execution and a resume restricted to the exact two previously created buckets. It pins source generations, prevents destination overwrite, strips custom download-token metadata, and compares actual SHA-256 bytes across source, backup and restore.

Direct REST rewrite attempts returned HTTP 400 (`required`); no source changes occurred and temporary grants were removed and checked. A separate PowerShell 7.5 JSON date-conversion issue was corrected with invariant/type-aware UTC handling. Copies now use the official Google Cloud CLI with the same configured identity and unchanged permission scope. A permission denial is a stop condition, not a reason to broaden access.

`scripts/staging-application-recovery.ps1` and `.mjs` isolate copied Firestore records and restored report files in local `demo-kreatum` emulators. The private temporary directory is restricted to the current Windows identity and SYSTEM. The probe uses synthetic local owners, not restored cloud accounts, and prohibits external browser requests, production access and cloud writes. It verifies administrator history and report downloads without regenerating reports.

Local results: storage guard/mock suite 105 PASS; application-recovery suite 13 PASS; wrapper guard check PASS with zero cloud calls; lint and frontend/backend TypeScript PASS; root unit suite PASS; backend unit suites 61 + 6 PASS. Frontend demo and Functions builds passed. These are not a full release-suite or production verification.

## Execution result

Object recovery PASS: run `recovery-ee710d63a63a47c6b0bed6f7e09efc76` verified all 9 objects / 15,417,725 bytes across original, independent backup and restore. Sorted SHA-256 aggregate: `bacf23e9809279bc9481b29b65ebefcf275970c47d4a24461be278b2ea14c8aa`. All temporary bindings created by this run were absent on cleanup readback. Independent bucket listings also showed 9 objects in each destination, without another page.

Application recovery PASS in the local isolated environment: run `recovery-873b829a03d44f92a0db284f75721cf7` restored and compared 395 records, then verified 6 artifact downloads across two report versions of one workshop through the administrator interface. PDF, PPTX and JSON bytes, sizes and formats matched the saved artifacts. Canonical document digest: `c1613a9379fca3294db92fcace966a53c3c0fc766b9620f359df3890873d6982`. One explicitly synthetic local owner was used. The older restored database references 6 artifacts; all 9 current storage artifacts were separately verified in the independent object-copy test. No cloud writes were made by the application probe and production was not accessed.

The test runner's initial local failures were corrected, not hidden: HTTP 405 came from using GET against a DELETE-only Auth emulator endpoint; HTTP 413 came from treating a large JSON report as an API JSON body. The corrected runner uses Auth batchGet and binary multipart upload, with regression tests preserving exact bytes and MIME. The emulator's limit and product behavior were not relaxed. A separate local Functions control configuration avoided an occupied UI port; it did not change the normal Firebase configuration.

Cleanup was verified: the private temporary directory and its copied files/browser state were deleted after all test services stopped. The temporary Functions configuration was removed. Readback found zero bindings from the copy run and zero public members on the original, backup and restore buckets. The cloud copies remain private under their documented seven-day lifecycle; they are not permanent production backups.

This proves isolated data/report application recovery, not restoration of Cloud Auth accounts, cloud IAM or a full cloud disaster-recovery exercise. `full-recovery` is not silently promoted to a broader certification. The local `dist` is a demo build and MUST NOT be deployed; rebuild for the explicitly authorized destination before any later publication.

## Release limitations

The live multi-organization preflight remains unverified after App Check throttling, recorded in `SECURITY_FINAL_CHECKS_2026-09-11.md`. MFA remains explicitly deferred by the user and is not passed. No production publication is authorized by this evidence alone.
