## 1. Freeze the shared contract

- [x] 1.1 Extend shared setup types and strict fixtures for separately negotiated version-2 fresh requests/replies, fresh review/plan/progress, format-3 journal grammar and consent hashes. Keep version-1/format-2 fixtures unchanged.
- [x] 1.2 Specify and test legal fresh creation checkpoints, absent-store observation, create/retain modes, source registration, capture policy, wrong-family refusal and immutable target evolution. Amend `setup/managed-steps.md` as the interface contract.

## 2. Implement bounded fresh creation and recovery

- [x] 2.1 Extend existing inspection/journal/publication owners for fresh review and pre-store journals; preserve legacy parsing/recovery and reject unsupported/foreign state.
- [x] 2.2 Extend existing private-directory and Store creation owners narrowly for the journaled boundaries, exclusive database creation, frozen Store identity and atomic initial capture-off. Measure prepare, directory and database requests using the portable actual-spawn counter; each must finish within six without cached authority or omitted checks before this unit is accepted.
- [x] 2.3 Add fresh effects and target validation to the existing engine: expectation, idempotent source registration, binding, new-store enable, reconciliation, retained capture preservation and single-use capture re-consent.
- [x] 2.4 Cover every recovery class in design section 5, including crashes within directory/database/publication creation, old/new checkpoint and lost-reply outcomes, changed objects, partial databases, sidecars, no-adoption refusals and data retention.

## 3. Integrate service negotiation and transport

- [x] 3.1 Route fresh requests through the existing worker/budget and scope/Store fence, including custom/missing Store roots; expose bounded fresh status without admitting absent storage or performing final scans.
- [x] 3.2 Advertise the fresh capability, enforce request/journal-family matching and Windows zero-work old-route refusal, and preserve non-Windows compatibility routes and independent capture-off controls.
- [x] 3.3 Extend real HTTP tests with empty and retained fixtures, stale/altered consent, wrong family, replay, contention, deadline/late-worker fencing, restart and actual UI-client journeys. Count all launches and retain existing migration regressions.

## 4. Extend the existing Setup client

- [x] 4.1 Extend the shared adapter/model/parser and single StepDriver for capability-gated fresh review/progress, correct per-plan stage labels and no old-route fallback. Preserve current migration and capture control behavior.
- [x] 4.2 Add fresh creation/reconnection, capture consequence and partial-recovery copy to the existing EN/RU/zh-CN copy owners. Preserve acknowledgement, focus, one-time announcements, pause/stop/resume and context retirement.
- [x] 4.3 Extend browser logic fixtures and the existing rendered QA driver for fresh review, running, paused off/unknown, failed/replayed, reopened and complete states; include capability mismatch and retained-store capture preservation.

## 5. Join native and integrated acceptance

- [x] 5.1 Extend `tests/backend/windows-service.test.ts` and the existing native driver/observer for empty-store setup, reconnection and representative recovery. Require all requests within six launches and undelayed eight seconds; require successful delayed setup at 2.5 seconds per helper below twenty seconds and concurrent zero-spawn health. Test slower-helper refusal separately.
- [x] 5.2 Run the real HTTP service with the current UI client through fresh creation and retained reconnection, including dropped replies, restart, pause/resume, uncertain enable and a later manual disable. Verify durable effects, not only response shape.
- [x] 5.3 Run rendered Chromium journeys and retain sanitized screenshots/interaction results for EN/RU/zh-CN at phone width, plus desktop keyboard/focus coverage. Do not describe synthetic-shell evidence as host/native certification.

Native Windows CI on #117 at `16f1b55` passed all fresh and migration journeys,
including the custom Store and retained new source, with at most six spawns per
request. Fresh setup took 2.8 seconds undelayed and 15.4 seconds with 2.5-second
helpers. This is evidence for that tested head, not a new final-candidate Windows
run. Portable substituted-spawn results are not native timing or NTFS evidence.

## 6. Documentation, generated outputs and delivery gate

- [x] 6.1 Update `docs/setup.md`, `docs/ui.md`, `docs/contracts.md`, `docs/backend.md` and `docs/compatibility.md` and final measured allocations in `setup/managed-steps.md`. Replace the obsolete fresh exception and distinguish estimates, portable counts, native results and untested environments. Correct the responsiveness spec purpose when synchronizing it; do not rewrite archived history.
- [x] 6.2 Keep any newly separated fenced test file in `scripts/ci-backend.ts`; adjust native CI lists/trace retention only if needed. Regenerate affected tracked backend and guest outputs with existing scripts after source integration, without unrelated version/output changes.
- [x] 6.3 Complete implementation typechecks, targeted regressions, native and rendered gates and independent trust-boundary/error-path review. Oracle and Paladin approved the implementation. Record unavailable checks honestly; retain state on rollback.

Final-candidate portable CI in a fresh full-history disposable checkout, release
eligibility/assets/name/body rehearsal, contributor reminder and public-diff review
are release-preparation gates. Their results belong to the tested candidate and
release verification record, not an inferred certification in this archive.

## Deferred acceptance and out-of-scope follow-up

- [ ] Final-candidate native-host Git/folder/ZIP installation and companion
  lifecycle/upgrade/rollback gates remain separate promotion requirements.
- [ ] Physical-phone app/browser acceptance and real distinct-host/source switches
  with a held reply remain deferred from 1.4.0; synthetic browser or session-switch
  evidence does not establish these cases.
- [ ] Broader native platform/version certification is out of scope. The Windows
  measurements above apply only to the tested head and environment.

No live profile, paid-model test, main promotion or publication is claimed here.
