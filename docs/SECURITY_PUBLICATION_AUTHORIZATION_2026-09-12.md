# Production publication authorization and remaining stops

The user explicitly requested "haz todo y publica" on 2026-09-12 after receiving the final technical results and remaining release blockers. This is the new production GO requested by the plan. The user's earlier decision to defer administrator MFA remains in effect; this request does not claim MFA is implemented.

This authorization does not itself prove pending checks passed or override tool-enforced access restrictions. No control status has been changed to passed without evidence. The earlier rejection of a persistent MFA gate exception remains documented in SECURITY_REMEDIATION_RUNBOOK.md; a general deployment request must not be used to silently bypass the gate.

## Safe work completed in this continuation

- Reviewed the localized schemaVersion correction, its handler regression test, Rules test and sanitized App Check diagnostic changes against the existing architecture.
- Kept the completed ten-check technical gate as evidence for those exact source changes; no application source or dependency modification was made after that run.
- Attempted to initialize the available supervised browser, then reset the session and retried once. Both attempts failed before browser access with a Windows sandbox helper startup error (deny-read ACL application). This is a tool startup failure, not a KREATUM application failure or a successful staging test.
- Did not repeat the previously rejected automated attestation using alternate identities, debug tokens or lower protection settings.

## Publication decision

No production deployment in this continuation. The full direct staging authorization matrix is still unverified. The operational gate still requires MFA and the broader recovery certification; data/report recovery alone does not certify Cloud Auth/IAM restoration. No exception or new privilege was added. Source consolidation is separate from release eligibility: after a new commit, a fresh gate result bound to that commit is required before publication.

To resume: restore the supervised-browser tooling or agree an authorized supervised validation method, complete the outstanding live checks, and explicitly resolve the MFA/recovery release-policy scope. Preserve the existing data/report recovery evidence and do not ask the user to repeat the completed A/B UI test.
