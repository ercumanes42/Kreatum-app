# Player reconnection and terminal-screen correction

## Authorization

The user explicitly answered yes to applying and testing this correction only in staging. Production deployment remains separately approval-gated. The earlier permission stop was resolved by this new approval.

## Confirmed cause

The failed staging browser had neither a stored workshop ID nor a stored team, yet still displayed Diluir. Session cleanup had succeeded: stale global/team synchronization could reapply the former phase to local React state. The old reset depended on a non-null local team, so a stale phase could survive after the team had already been cleared.

A second recovery weakness was found: a terminated Firestore listener did not restart. The client now rechecks the authorized server document after reconnection, visibility return or a listener/heartbeat error. It never interprets permission-denied or another generic error as proof of workshop completion.

## Changes

- `src/PlayerApp.tsx`: absence of the authoritative workshop ID immediately selects the existing initial room-code screen. Old phase/team effects cannot repopulate a departed workshop. The previous phase animation and exit dialog cannot survive logout. No game mechanics changed.
- `src/hooks/useRealtime.ts`: optional player recovery uses `getDocFromServer` on the current workshop, restarts the listener after an active-state read, and cleans up on scope change/unmount.
- `src/lib/workshopRevalidation.ts`: single-flight reads and recovery-only backoff from one to thirty seconds; paused when offline/hidden; no periodic polling on healthy streams. New server snapshots invalidate older in-flight reads.
- `src/lib/workshopRevalidation.test.ts`: eight focused tests, including late responses, errors, disposal and scheduled recovery.
- `e2e/gameplay-resilience.spec.ts`: two new scenarios (offline closure and listener-denied then closure), plus a thirty-second cold-start allowance for entry instead of the former five seconds. Assertions are retained, not skipped.

## Evidence and boundaries

The first four-case local run failed the cold-start timeout and exposed the stale-screen bug after listener denial; the other two cases passed. These failures were not treated as a pass. The final corrected run and live staging repetition must be recorded below before accepting this fix.

Rules, Functions, IAM, App Check enforcement and production are unchanged by this frontend-only correction. Earlier staging Function/Rules publication is documented separately in `SECURITY_STAGING_DEPLOYMENT_2026-09-11.md`.

This correction does not close unrelated disaster-recovery or multi-organization live-validation limitations. No claim of complete platform security follows from this test.

## Final local verification

- Lint, TypeScript and both frontend staging / Functions staging builds passed.
- Unit suite: 78 tests plus 41 script tests passed, with no skips or failures.
- Four targeted Chromium emulator E2E tests passed in 2.6 minutes: expired participant closure, offline closure without reload, denied-listener recovery without reload, and sub-750ms write preservation through offline transition recovery.
- This is not a rerun of every viewport/browser or the complete live multi-organization matrix.
- Frontend index SHA-256: `ab65685f96157ea81121947960a7a2fd5692ec0b461215e37a9ec1a99e7b5356`.
- Compiled assets reference staging, not the production Auth domain.

## Staging-only publication

Hosting alone was deployed to `kreatum-dinamic-staging`. Readback confirmed release `1789158571887000`, version `7d1719e785b17fb1`, at `2026-09-11T20:29:31.887Z`. HTTP readback serves the expected `index-8O1IDoB2.js` bundle.

Rollback reference: previous staging Hosting version `d296a3fc91122159` (release `1789155074180000`). Rolling back would reintroduce the stale-screen issue: stop promotion and reassess that regression explicitly. No backend, Rules or production rollback is part of this frontend correction.

Live repetition uses synthetic staging workshop SECQA912. Entry, Agua selection, Calcinar-to-Diluir progression and a persisted synthetic perspective after reload were verified. Player network went offline at `2026-09-11T20:33:57.288Z`. Final closure/reconnection outcome remains to be recorded below.

## Live result: PASS

The owner panel showed Agua offline and finalized SECQA912 through its normal confirmation, without forcing the transition. History subsequently displayed SECQA912 as Completed.

At `2026-09-11T20:36:35.852Z`, the player browser recovered connectivity without any page reload. It changed from the visible Diluir phase to the welcome/code screen in 844 ms. The code field was empty; Diluir and the expired-session message were absent; workshop/team local-storage keys were absent (only presence booleans were inspected). The synthetic perspective had already survived a reload before going offline.

Offline network failures appeared in the existing browser console as expected; their cumulative count is not evidence of unrelated production errors or a clean-console claim. The four-case emulator result separately covers denied-listener recovery.

This frontend correction is accepted in staging. Production was not changed. The synthetic completed workshop remains as evidence; no customer data was reset, deleted or modified.
