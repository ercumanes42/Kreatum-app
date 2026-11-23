# Staging attestation diagnostic - 2026-09-12

## Confirmed result

One user-authorized normal preflight, run `security-stage-mty1ld4n-20b31f36b948cc14`, stopped in the `owner` context with HTTP 403 and SDK code `appCheck/initial-throttle`. No Auth accounts or workshop fixtures were created; zero live security checks passed. Evidence: `output/staging-security-smoke/security-stage-mty1ld4n-20b31f36b948cc14.jsonl`.

The installed App Check SDK can report `initial-throttle` after an HTTP rejection; the name alone does not establish rate limiting. The test transport now preserves only the numeric HTTP status alongside its existing sanitized diagnostics. Provider messages, tokens and arbitrary payloads remain excluded.

## Configuration readback

Read-only Google Cloud checks confirmed that the staging app's configured reCAPTCHA Enterprise site key matches the local staging configuration. The allowed domains include the actual test origin `kreatum-dinamic-staging.web.app`, plus the staging Firebase and Vercel domains. All-domain access is disabled, the integration type is SCORE, no testing override is configured, App Check token TTL is 3600 seconds, and the configured minimum valid score is 0.1. No configuration was changed.

This rules out the specific local-key mismatch and missing-origin hypotheses. It does not establish the exact reason for the 403, prove ordinary user access fails, or verify cross-tenant authorization.

## Validation and release boundary

The diagnostic patch passes lint, TypeScript checking and all 20 transport/smoke unit tests, with no skipped tests. A staging-mode build also passed into the separate `output/security-diagnostic-staging-build` directory; it was not deployed and did not overwrite the existing demo `dist` directory. These are local checks, not the blocked live tenant matrix. No debug tokens, alternate identity, lower attestation threshold, disabled enforcement or production deployment were used.

The live tenant matrix remains pending. The next step requires an approved resolution of the test-browser attestation rejection or an agreed supervised validation method; do not silently bypass the protection or report this check as passed. Earlier recovery evidence remains scoped to the data/report exercise documented separately. MFA remains deferred by the user, not verified or enabled.
