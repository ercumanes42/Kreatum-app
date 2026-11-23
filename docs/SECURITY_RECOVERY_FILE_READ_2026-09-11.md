# Isolated restored report integrity — 2026-09-11

## Authorization and scope

The user explicitly authorized enabling read-only access to the staging files and completing browser validation without reducing protections. Production, MFA, App Check enforcement and existing unrelated permissions were not changed.

The configured Google Cloud user received `roles/storage.objectViewer` only on six exact object resource names from two reports in the already restored Firestore database `security-restore-20260911`. An IAM condition restricted those names and expired within one hour. No bucket-wide object listing, object writes, alternate identity or service-account impersonation was used.

## Verified result

- Script: `scripts/verify-restored-report-files.ps1`; 38 local assertions passed before execution.
- Read-only precheck: `security-restore-cbcc629888cb407cb940f881203e918e`, two documents/six references, no IAM mutation.
- Authorized execution: `security-restore-d7abe8135cda441a9a7a93423f81920e`.
- Six of six files verified: two PDF, two PPTX and two JSON.
- Metadata sizes and SHA-256 of downloaded bytes matched the restored report references. Downloads were generation-pinned and held only in memory. Format checks also passed.
- `status=verified`, `hashChecks=all-match`.
- The temporary binding was removed in `finally`, using a fresh policy and etag to preserve unrelated changes. Readback confirmed `cleanup=own-binding-absent-verified`.
- No client content, tokens or personal data was emitted. No object was modified or deleted.

## Boundaries

This closes the permission blocker and verifies that the restored Firestore reports still refer to intact existing Storage files. It does **not** demonstrate recovery from an independent Storage backup after loss of the bucket, nor full application operation against the isolated named database. Those are distinct from integrity verification and are not marked passed by this result.

## Manual browser access

The user completed password recovery and logged in to the real staging `/admin` page. The browser displayed the administrative navigation without a login form or access-validation error, and navigation to `/admin?section=history` succeeded. No credentials or session tokens were extracted. This verifies normal manual access to the currently deployed version; it does not certify the unpublished candidate or the complete gameplay/report flow.
