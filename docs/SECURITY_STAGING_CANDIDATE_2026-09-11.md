# Security staging candidate — 2026-09-11

## Scope and approval

The user authorized finishing the staging candidate, confirming alert delivery and testing recovery. MFA is explicitly deferred. Production requires a fresh GO after the requested checks; no production deployment is authorized by this report.

The original working directory was preserved. An isolated candidate was created at `tmp/security-staging-candidate-20260911`, branch `codex/security-remediation-2026-09-11`, from `f4c2790e37b8808043505996a2ade3f2d05dcb33`, with the relevant existing application/security/report changes copied without altering the original work.

## Verified on the isolated candidate

- Fresh root and Functions `npm ci` completed successfully.
- Lint and frontend/backend TypeScript passed.
- Root/shared and Functions unit suites passed, including authorization and vendored PPTX checks.
- Firestore/Storage Rules: 21 passed, zero skipped or cancelled.
- Integration in six isolated emulator batches: 11 passed, zero skipped or cancelled. Includes tenant isolation, reporting authorization, device takeover, post-ACK write freeze and concurrent owner/facilitator revocation.
- Final QA transport/diagnostic tests: 19 passed; release guard tests: 7 passed. These tests do not contact cloud. They are now part of the normal unit-test command.
- Frontend `--mode staging` and Functions `build:staging` completed.
- Compiled frontend contains the staging project and not the production Auth domain. Staging configuration retains `KREATUM_ENFORCE_APP_CHECK=true`; no protection was disabled for testing.
- Dependency audit: frontend zero advisories; Functions zero high/critical and two moderate advisories retained as residual risk.
- Reviewed vendor bytes are preserved by `.gitattributes`; four dedicated package-integrity/PPTX tests passed. Upstream whitespace was intentionally not rewritten. The application-code staged whitespace check excludes the byte-preserved vendor tree.

These are local results. They do not prove a deployment, live browser gameplay, full recovery or production readiness.

## Alert delivery

All four staging categories have receipt evidence. The three new user screenshots corroborate reports, backups and workshop completion. See `SECURITY_ALERT_DELIVERY_2026-09-11.md`. These messages are controlled probes, not real customer incidents. Incident recovery is not certified by receipt alone.

## Recovery blocker

Firestore backup restoration to the isolated named database succeeded. Six report artifact references have structurally valid metadata. Actual Storage object reads were denied with `storage.objects.get` (HTTP 403). No file bytes or checksums were verified. A 403 does not establish that a file is missing.

This is an actual permission boundary. No alternative identity, signed-URL workaround, IAM change or production restore was used. Full recovery remains pending.

## Live staging check boundary

The QA browser transport requires normal Enterprise App Check attestation in five isolated staging browser contexts before creating synthetic fixtures. A rejection stops the run; no debug tokens, CSP bypass or enforcement change are permitted. This transport tests SDK/backend authorization only, not the actual user-interface workflow.

The real preflight was rejected before creating accounts or workshops. Sanitized cause: `Normal App Check preflight rejected. Stop without fixtures.` Diagnostic run: `security-stage-mtxbpz9n-4887b16dcf8e6525`. This proves the automated preflight did not pass, not that normal users cannot access staging. No alternate identity, debug token, disabled protection or repeated challenge workaround was attempted after confirming rejection.

The first runner revision incorrectly labeled all failures `retainedFixtures:true`; that flag is not evidence of fixture creation. In these preflight-only runs, the return/throw path precedes all Auth creation and Firestore writes. Staging publication and real UI closure/report checks remain pending. No cloud deployment was performed.

The final diagnostic version fixes that flag and reports only allowlisted stages, categories, HTTP statuses and SDK codes, without raw errors or credentials. It was tested locally and was not used to retry the rejected cloud check. The original workspace remains uncommitted and preserved; consolidation applies only to the isolated candidate.
