# Tasks

## 1. Shared binding and managed setup contract

- [ ] 1.1 Freeze the managed setup revision, fixed actions and expected-reviewed-identity checks in `shared/progress.ts` and `docs/contracts.md`; preserve report/schema/control semantics and explicit old-service handling.
- [ ] 1.2 Implement identical canonical data-root discovery, owned private subfolder/marker checks and separate read-versus-confirmed-create paths in the existing binding/platform owners. Remove managed fallback/adoption and preserve Windows ACL/object checks.
- [ ] 1.3 Extend SetupController with explicit managed configure/inspect/control, verified retained-source reuse, atomic descriptor persistence and private expected-fingerprint metadata. Keep service diagnostics reachable on invalid/unavailable state and preserve authenticated bounded request handling.
- [ ] 1.4 Exercise absent/invalid/foreign/symlink/permissive state, invalid XDG, state-root omission, store/source mismatch, unsupported schema and concurrent selection. Prove reads create nothing and failed confirmation cannot select or reset a store.

## 2. Companion lifecycle and legacy migration

- [ ] 2.1 Adapt the companion to the common resolver and dormant/coalesced activation after explicit configuration. Reuse tool/skill/guidance/delegation owners, preserve effective-tool restrictions, pin runtime identity and clean partial registration.
- [ ] 2.2 Record managed runtime release/fingerprint independently of legacy binding version, and make mismatches warning-only. Add synchronous retirement plus post-await checks so pending initialization/reporting cannot publish after disposal; preserve existing error shapes.
- [ ] 2.3 Add full-ownership legacy discovery and a single confirmed migration using existing `remove-capture`. Refuse different store/source, preserve history, and support safe same-target interruption/retry without automatic re-enable or takeover. Keep legacy removal/recovery for at least one release; remove fresh global installation from the normal entry paths.
- [ ] 2.4 Test actual legacy fixtures, duplicate/coexistence behavior, modified ownership, mismatch, concurrent/stale confirmation, pending migration, descriptor publication failure, repeated submission, partial teardown and report-permission races. Keep progress/cleanup/run invariants and retained data intact.

## 3. Setup and reporting-health consumers

- [ ] 3.1 Update the existing UI adapter/model/controller for the frozen managed setup revision. Replace the normal global-install/update/remove journey with explicit private-store configuration and legacy-only migration/recovery; preserve custom-store edits and unavailable/unverified states.
- [ ] 3.2 Update existing reporting-health rows, fixed support classifications and lifecycle/integrity explanations without inventory permissions or polling. Keep source/store association, bounded reads, retired-response guards and copy privacy. Leave the official-version checker/notice behavior untouched.
- [ ] 3.3 Localize new extension-owned consent/errors/status/accessibility text in English and Russian. Test cancellation, failed and partial migration, old service, missing/mismatched observation, stale/unknown delivery mode, keyboard/focus and narrow layouts.

## 4. Distribution and durable guides

- [ ] 4.1 Add the companion directory contribution while retaining the host/dependency floors and existing contributions. Extend package, host/Git entry and generated parity assertions to validate the declared resolvable plugin folder and shipped versions; keep release asset compatibility and no consumer build.
- [ ] 4.2 Update README and setup/contracts/backend/UI/compatibility guides with the new normal path, explicit binding authority, migration, delivery/reach matrix, warning-only integrity, changed version/update contracts and safe rollback. Label retained legacy guidance and historical proof; do not rewrite unrelated update-notice behavior.
- [ ] 4.3 Regenerate affected backend/setup/companion and guest entries with repository scripts. Retain unchanged generated entries when their inputs are unchanged; never hand-edit runtime bundles.

## 5. Behavioral acceptance and trust review

- [ ] 5.1 Build a reproducible disposable managed-host acceptance fixture from existing native/browser harness conventions: fresh HOME/all XDG roots, actual web UI, independent OpenCode, loopback-only runtime networking and credential-free scripted reporting. Do not transplant research-only descriptor overrides into the production discovery proof.
- [ ] 5.2 Drive real install/plugin approval and explicit configuration, then report in a new session and inspect rail, Work Status and board. Exercise disable/re-enable/remove, retained history, pending-permission disposal, restricted-tool refusal and non-managed reach. Retain sanitized screenshots and state assertions.
- [ ] 5.3 Drive real legacy coexistence/migration and no duplicate capture, interrupted/mismatch refusals and a warning-only changed-byte case. Verify caller-owned-config fallback across explicit disposable restarts; record mode-specific limits and session interruption honestly.
- [ ] 5.4 Run focused backend/browser/native-path regressions, full backend/browser/package suites, current SDK validation and generated parity against stable accepted inputs. Run real supported-host folder/ZIP/Git checks and actual below-floor refusal; report missing prerequisites/skips without a pass claim.
- [ ] 5.5 Complete independent security review of plugin execution, mutable-folder trust, private binding/state creation, full-ownership legacy removal, concurrent/disposal safety and lack of ambient authority. Resolve blocking findings; semantically review all public files/screenshots for private data and obsolete normal-path lifecycle claims.
