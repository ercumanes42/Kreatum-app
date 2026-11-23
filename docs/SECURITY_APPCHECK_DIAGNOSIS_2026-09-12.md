# Staging App Check rejection diagnosis

Scope: diagnose the blocked normal browser and run the stale-team scenario if authorized attestation succeeds. Production, MFA, A/B manual tests and disaster recovery are outside this turn's mutation scope.

## Verified observations

- Earlier live execution stopped at the App Check exchange on 2026-09-12T10:45:31.134Z: HTTP 403, `appCheck/initial-throttle`, first context `owner`. No fixture or gameplay check ran.
- Current readback of staging's Enterprise provider matches the locally configured site key. TTL is 3600 seconds; minimum score is 0.1.
- The score-based reCAPTCHA key explicitly allows `kreatum-dinamic-staging.web.app`. `allowAllDomains` is false and no testing override is configured.
- Aggregate reCAPTCHA metrics contain scores both below and above the configured threshold. These aggregates cannot identify the score or cause of the particular failed request.
- Cloud Logging returned no App Check/reCAPTCHA audit entries in the bounded 10:44-10:47 UTC failure window. Absence of those logs does not prove absence of an assessment.
- Reading API-key metadata through `keys:lookupKey` returned HTTP 403. That diagnostic branch stopped; API-key restrictions remain unverified. No alternate principal, IAM change or credential extraction was used.
- Installed Firebase SDK source, `node_modules/@firebase/app-check/dist/esm/index.esm.js`, lines 1422-1438, applies a one-day provider backoff after HTTP 403 or 404. `initial-throttle` is a consequence of the exchange rejection, not proof that a user spent too long in a game or exceeded a game timer.

## Conclusion and limitations

The rejection is before gameplay authorization. A wrong staging reCAPTCHA site key or a missing staging hostname was not found. Automated-browser risk rejection is plausible but not conclusively proven; the exact server error and the individual risk assessment are unavailable. API-key restrictions also remain unverified. No security defect in the player flow can be inferred from this rejection.

No new automated attestation attempt was made during this diagnosis, no browser state was reset to evade backoff, and no protection or threshold was changed. The requested stale-team scenario remains NOT EXECUTED in live staging, not passed. The prior successful A/B manual flow is not reopened.

## Explicit approval boundary for another test method

Firebase documents a debug provider for automated testing. A private, short-lived-in-use staging debug credential could authorize the test browser while keeping deployed Auth, Rules and Functions permission checks active. However, it is an exception to normal device attestation, not equivalent evidence that normal reCAPTCHA accepts the browser. It requires explicit user approval, private handling, prompt revocation with readback, and a separately scoped test harness; the existing runner intentionally rejects debug credentials. No credential has been created or registered.

Alternatively, conduct the scenario through normally attested browser sessions or obtain diagnostic access/support for the original rejection. Neither route may be reported as completed until the expected denials and legitimate-owner actions are observed.

References:
- https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
- https://firebase.google.com/docs/app-check/web/debug-provider
- https://docs.cloud.google.com/recaptcha/docs/reference/rest/v1/projects.keys/getMetrics

Only this diagnostic document was added in this turn. No application code, deployment or cloud configuration changed; build/lint/gameplay suites were not rerun because the live prerequisite remains blocked.
