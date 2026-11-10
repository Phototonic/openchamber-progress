# Implementation tasks

## 1. Durable storage and time policy

- [ ] 1.1 Freeze and validate both known version-1 shapes; add exact format-2 definitions and singleton invariants, activation-only migration, read-only version-1 compatibility and transactional rollback coverage.
- [ ] 1.2 Extend the central loss helper to record backend detection time and sequence without changing loss classification, native evidence or passive-failure isolation. Preserve capture generation and ordinary no-loss reclamation.
- [ ] 1.3 Add service-derived attention and additive read metadata. Test no loss, migrated unknown loss, fresh loss, exact 24-hour boundary, clock reversal, timestamp range, reopen and cursor/revision behaviour with controlled time.
- [ ] 1.4 Exercise unmodified old-base and immediately preceding run-aware binaries against upgraded storage in isolated processes; prove integrity, preserved trigger behaviour, expected refusal and recovery with new binaries. Update the future-format rejection fixture beyond the newly supported format.

## 2. Authenticated acknowledgement

- [ ] 2.1 Add the narrow dismissal request/reply contracts and existing-route integration, with bounded parsing, duplicate-key refusal, verified identity, explicit format support and capture-off behaviour.
- [ ] 2.2 Implement transactional sequence fencing and no-op retry semantics. Prove both loss/dismiss race orders, same-time losses, two connections, stale/future requests, rollback and no changes to progress, run facts or reconciliation work.
- [ ] 2.3 Extend real authenticated HTTP tests for request/response metadata, failure status, wrong identity, missing bearer, bounds, duplicate fields, pre-activation version-1 mutation refusal and persisted acknowledgement across roots/reopen.
- [ ] 2.4 Update backend, wire, compatibility and setup documentation for migration, clock provenance, durable versus attention disclosure, mixed versions and post-migration rollback limits.

## 3. Guest integration after the prerequisite disclosure change

- [ ] 3.1 Integrate only after the muted Partial/disclosure UI is accepted. Extend the existing adapter/source contracts, including legacy fallback and malformed-format-2 refusal; preserve old-guest compatibility fixtures.
- [ ] 3.2 Extend the existing run visit controller for explicit acknowledgement, pending/error state, revision ordering, retirement and immediate initiating-view application. Reuse ordinary refresh for other surfaces; add no channel, preference store or poller.
- [ ] 3.3 Enrich only the capture-loss roster note and existing disclosure. Implement warning versus muted tone, dated/unknown-date text, acknowledgement controls, Work Status gating, permanent incomplete markers, approved copy and existing focus/announcement conventions.
- [ ] 3.4 Extend adapter/controller/roster tests and the current browser fixture/driver for recent, old, dismissed, migrated and legacy states; new-loss and delayed-response races; same-store multi-surface propagation and other-store isolation; keyboard/pointer interaction and screenshots.
- [ ] 3.5 Amend `docs/ui.md` on top of the prerequisite edits, including note policy, controller lifecycle, selectors and current QA coverage without claiming native-host certification.

## 4. Integration and delivery

- [ ] 4.1 Run focused backend and browser-model tests and both TypeScript checks; regenerate backend entries and all three affected guest bundles with the repository scripts.
- [ ] 4.2 Run rendered-browser interaction checks against current built guests, record sanitized screenshots of the meaningful notice states, and verify expiry/dismissal cannot turn incomplete coverage into complete counts.
- [ ] 4.3 Run the portable CI/generated-entry/package checks in a fresh disposable checkout, review the full public diff for private data, and report skipped native-host gates honestly.
- [ ] 4.4 Keep this as its own pull request stacked after the prerequisite. Document the no-intermediate-release boundary and forward recovery after activation; do not bump versions, migrate live profiles, commit local evidence or release either change independently.
