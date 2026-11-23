# Staging team recovery: verified

## Result

PASS: 17 live checks on the deployed staging backend, using three synthetic anonymous players and the temporary App Check debug credential explicitly authorized by the user. No production mutation or deployment. The completed manual A/B company test was not repeated.

Run: `security-stage-mtyatv2g-860f826b536d6496`, 2026-09-12 11:25:37-11:26:29 UTC.

## Observed checks

1. Original player and peer can create legitimate attacks.
2. After synthetic expiry of the original player's reservation, another player acquires Agua.
3. Old player cannot submit an attack for the occupied team.
4. Old player cannot update an existing attack.
5. Old player cannot delete an existing attack.
6. Old player cannot save a defense.
7. Old player cannot reconnect as the occupied team.
8. Reusing a previously successful idempotency key does not recover old permissions.
9. Old player cannot read Agua's private team document.
10. Old player cannot read its private attack document.
11. Current owner can read the team and save a defense; the original attack is unchanged.
12. Firestore Rules reject the old player's solution write.
13. Current owner's solution is saved and read back with the expected content.
14. Original player's room-code reentry returns `team: null`.
15. Reentered player cannot select occupied Agua.
16. Reentered player can select free Aire and submit a legitimate attack.
17. Current owner can reconnect normally to Agua.

For stale-ownership denials, the fixture deliberately gives the old player a valid new device slot and unexpired session while Agua belongs to the new player. Preconditions verify those leases and the active phase; denials are not misreported expired-session failures. Expiry was simulated only in this synthetic workshop, not by changing application timers or disconnecting real users.

## Credential and fixture cleanup

- Created at 11:25:44 UTC; revoked at 11:26:29 UTC. Removal verified by GET returning 404 and by absence from the staging app's debug-token list.
- Separate readback at 11:29:07 UTC confirms the credential is absent, the synthetic workshop is completed, and its active-room index is absent. Original attack and legitimate solution content remain intact.
- Synthetic records remain in staging as evidence; no customer data were deleted. Three isolated browser contexts were closed. No token, password, trace or browser storage-state file was exported.
- Deleting the debug credential prevents future exchanges; already-issued App Check tokens can remain valid until expiry. Their browser contexts were closed and their values were not exported. This is not a claim of instantaneous revocation of every issued bearer token.
- All seven exercised Functions remain ACTIVE and `KREATUM_ENFORCE_APP_CHECK=true`, checked at 11:30:44 UTC. Risk threshold stays 0.1 and normal provider TTL stays 3600 seconds. No thresholds, Rules or IAM permissions were relaxed.
- Deployed Firestore Rules match local SHA-256 `79373ed00c46f5e3fd31be7cc6b74a1811ad3435cddfafcb57ac6c85e13e7970`.

## Evidence files

- `output/staging-team-recovery-proof/security-stage-mtyatv2g-860f826b536d6496.jsonl`: timestamped 17 checks and credential lifecycle.
- `output/staging-team-recovery-proof/security-stage-mtyatv2g-860f826b536d6496-readback.json`: independent fixture, Rules and credential readback.
- `output/staging-team-recovery-proof/security-stage-mtyatv2g-860f826b536d6496-enforcement.json`: all seven Functions still require App Check.
- Runner: `scripts/staging-team-recovery-proof.mjs`; safety tests: `scripts/staging-team-recovery-proof.test.mjs`.

## Local verification

- 28 runner tests PASS, zero failed or skipped, including ambiguous credential creation and cleanup on failed tests.
- Repository lint PASS after correcting the diagnostic error's cause preservation.
- Frontend and Functions type checks PASS.
- Frontend staging build PASS in `tmp/team-proof-build-20260912`, leaving `dist` unchanged.
- Functions `build:production` PASS locally, without deployment. An initial attempt to supply `--outDir` was rejected by the manifest generator; the correct existing build script was then run.
- Published artifact tree hashes still match: `dist` = `8092e5cd8e89d5d4dedc8d8d701cab490a050b27e15967b172b335a1ef9a69a7`; `functions/lib` = `e4265978055f7170b2741416db22c6850d899b4423a4c87ae94c34fd1b171da1`.
- The whole release gate, unrelated test suites and production E2E were not rerun. No new release was made.

## Scope boundary

This closes the requested live stale-team authorization scenario under an explicitly authorized test attestation. It does not establish that normal reCAPTCHA accepts automated browsers or conclusively identify the earlier provider rejection. That limitation is separate from player authorization. Full cloud identity/IAM disaster recovery is not addressed here. Administrator MFA is excluded from this delivery by the user's decision, not represented as implemented.

Together with `SECURITY_MANUAL_TENANT_TEST_2026-09-12.md`, this supplies the agreed staging access-validation evidence. It is not a claim of comprehensive cybersecurity certification.

Official test-provider reference: https://firebase.google.com/docs/app-check/web/debug-provider
