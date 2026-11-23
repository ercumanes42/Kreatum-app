# Staging security deployment — 2026-09-11

## Scope

Production remains untouched and requires a fresh explicit GO. MFA is deferred by the user. No App Check protections were disabled. The original working tree was preserved; deployment uses the isolated `codex/security-remediation-2026-09-11` candidate at commit `5074bd0`.

## Verified publication

The initial targeted deployment updated 22 Functions, Firestore Rules and Hosting successfully. Readback found 69/69 Functions ACTIVE, all 69 retaining `KREATUM_ENFORCE_APP_CHECK=true`, with exactly 22 recent updates at that point.

- Hosting release: `sites/kreatum-dinamic-staging/releases/1789155074180000`.
- Hosting version: `sites/kreatum-dinamic-staging/versions/d296a3fc91122159`.
- Release time: `2026-09-11T19:31:14.18Z`.
- Firestore SHA-256 read from the active release: `79373ed00c46f5e3fd31be7cc6b74a1811ad3435cddfafcb57ac6c85e13e7970`, identical to the candidate.
- Storage Rules were not deployed or changed.

## Live compatibility finding and correction

The first browser reload exposed a real staging mismatch: the older `listMyOrganizations` returned HTTP 200 and an owner membership but omitted `operationalStatus`. The new frontend consequently displayed an unavailable-access screen with an empty explanation. This was not an authentication failure or a disabled account.

`listMyOrganizations` was subsequently updated successfully from the same candidate. A normal UI retry returned HTTP 200 with `operationalStatus=active` and `role=owner`; the history panel became accessible again. No account, role or organization data was changed to obtain access.

The original list of 22 functions compared the candidate against local HEAD, not against each actual older staging revision. That was insufficient to establish deployment compatibility. Actual generation-pinned source comparisons additionally confirmed missing transaction permission checks in `commitWorkshopTransition` and outdated authorization/cache handling in `createWorkshop`. Their coordinated update is in progress; it must not be described as successful until completion is checked.

## Follow-up deployment and live results

All additional confirmed updates completed: listMyOrganizations, createWorkshop, commitWorkshopTransition, cancelWorkshopTransition, updateWorkshopControl, reassignParticipant, releaseParticipantSession, resumeWorkshopByCode, queueReportGeneration, publishReport, resetWorkshop, deleteWorkshop, restoreWorkshop and archiveOrganizationWorkshops. No reset, delete or archive operation was executed. Final readback at this stage: 36 updated Functions, 69/69 ACTIVE, 69/69 retaining App Check enforcement.

The normal UI created synthetic workshop SECQA911. A separate player entered its code, selected Agua and followed Calcinar and Diluir. Three synthetic responses persisted after reload. With that player offline for more than two minutes, the administrator finalized normally without forcing; history confirmed completion.

Report generation and the three browser downloads succeeded. Format checks passed:

- PDF: 321967 bytes; SHA-256 3ff47dbc9cf1e5511c691334d3f1f811bb4ff005872f2bad0805adb2f0729465.
- PPTX: 440896 bytes; SHA-256 c83d8e07885980378f7c8e9a28c5bb944845a7c3f5aa54013009fe2a97a2dfe6.
- JSON: 11196 bytes; SHA-256 e932cdf620a5183fddd2383d5210b6764043257cc346c570eff922fe2fccaf1c.

Confirmed failed acceptance check: after restoring the player network, the visible, online browser remained on Diluir for more than six minutes, rather than returning to room-code entry. There was no expired-session message. Console recorded permission-denied on participant-session and selected-team subscriptions. No access protection was bypassed. A bounded frontend recovery fix and a fresh repeat of this scenario are required; promotion remains stopped.

## Remaining verification

- Creation, room-code entry, team selection, phase sync, persistence, administrator closure with an offline player and PDF/PPTX/JSON downloads passed. Automatic player return after offline closure failed; full staging acceptance remains pending.
- Other older function revisions require explicit compatibility review; successful compilation alone does not establish that mixed revisions are safe.
- Alert delivery is verified in `SECURITY_ALERT_DELIVERY_2026-09-11.md`.
- Restored Firestore records and all six existing report files passed integrity verification; temporary exact-object access was removed. See `SECURITY_RECOVERY_FILE_READ_2026-09-11.md`. Independent Storage backup restoration and full application disaster recovery remain unverified.
- Production is not approved by these partial staging results.

## Rollback references

## Approval stop for the newly discovered recovery fix

The local frontend recovery edit was rejected by the permission reviewer. One justified retry supplied the user's later implementation/staging approvals; it was also rejected because the reviewer requires a fresh explicit GO after the earlier audit-only restriction. No frontend recovery code was changed, and no workaround or alternative editing route was attempted. The prepared design uses authorized server reads after reconnection/listener failures, bounded backoff only during recovery, and terminal-state confirmation before leaving the workshop. No permission widening is proposed.

Current outcome: staging has the 36 verified Function updates and the published Rules/Hosting candidate. Alert delivery, restored-file integrity and synthetic report downloads are verified. The player's offline-completion return failed and remains unresolved; independent Storage/full-application disaster recovery remains unverified. No production publication occurred. A new explicit approval recognized by the permission system is required to apply and test the bounded frontend fix.

The JSON download contains all three exact synthetic responses entered during the test. The completed synthetic workshop SECQA911 and its report remain in staging as evidence; existing customer workshops were not reset, deleted or archived.

Previous Hosting version: `sites/kreatum-dinamic-staging/versions/b46bdae735cb15b3` (release `1786372972504000`). This identifies only Hosting, not a safe coordinated backend rollback. Do not roll back security Rules or Functions blindly: preserve the permission fixes or temporarily restrict the affected flow if a regression requires containment.
