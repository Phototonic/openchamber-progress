# Tasks

## 1. Native-host update fixture and evidence

- [x] 1.1 Extend the existing Git distribution gate and reuse the managed-host/real-browser fixtures for an isolated OpenChamber web 2.7.1 update journey. Remove the Git gate's dependency on the extension metadata reader while preserving package validation, trust retention and failed-update preservation checks.
- [x] 1.2 Exercise default/main, explicit main, development branch and tag selection with a local bare remote and built disposable versions. Prove same-version commits alone produce no offer, folder/ZIP have no Git update, automatic successful checks are cached, explicit checks bypass that cache, and the clock-seamed hour boundary works. Keep transport mapping isolated and labelled.
- [x] 1.3 Drive real Update available/Update, same-permission retention, added-capability deferral and approval. Check synthetic account/settings state, grants/scopes, paused state, installation storage identity, device language, private binding and history. Do not add shipping integration permissions for test coverage.
- [x] 1.4 Observe a running service, already-loaded frames and managed companion across replacement; record new service access, frame remount and actual matching/differing/unknown load observations. Include watched-mode and caller-owned-config limits without implying automatic restart or cancellation guarantees.

## 2. Compatible network and UI retirement

- [x] 2.1 Announce retirement in `docs/contracts.md` before sequential consumers change. Preserve the route/DTO compatibility shape and fixed request refusals; replace the checker with the network-free unavailable response. Remove obsolete transport/cache/timer/shutdown machinery and update the backend guide.
- [x] 2.2 Remove official-main presentation and request/scheduling/dismissal activity from all three guests and their shared owners. Remove now-unused update mapping/model/link/style code without changing independent Setup, progress, focus, height or language behavior; leave stored dismissal data inert.
- [x] 2.3 Refine managed update/load copy through existing Setup and reporting-health owners in English and Russian. Keep warning-only differences, unknown states, mode qualifications and legacy recovery boundaries; add no updater or restart action.
- [x] 2.4 Replace obsolete metadata-fetch tests with actual authenticated route/no-outbound tests, including unconfigured/unavailable stores, repeated calls, initialization and shutdown. Adapt packaged-service verification without dropping its unrelated timing checks. Verify unchanged old parser/guest against the new reply and new guests against old services.
- [x] 2.5 Add rendered and controller regression coverage for no route calls/no notices across readiness, refresh, session, visibility and failure states, plus affected managed observation copy and retained language/layout/focus behavior.

## 3. Documentation and generated distribution

- [x] 3.1 Update README, Setup, UI, compatibility and relevant contributor wording from the measured native results. Remove the current small-network-check disclosure and obsolete current official-main guidance; preserve clearly historical records. Explain source refs, version-based offers, manual ZIP/folder replacement and bounded reload behavior. Do not promise a deep-link button.
- [x] 3.2 Regenerate affected tracked backend and visible guest outputs with existing scripts, preserving unrelated outputs and manifest contributions. Do not bump versions or add permissions/dependencies.

## 4. Acceptance and handoff

- [x] 4.1 Run focused source/API/browser tests and the actual-host/browser journey against final built bytes. Retain sanitized screenshots, request/operation counts, versions, byte identities, state-retention assertions and owned-process cleanup evidence. A skipped host check is not a pass.
- [x] 4.2 Run root/UI typechecks, browser tests, portable CI/generated parity and package checks on stable inputs in a fresh disposable full-history clone; run actual supported-host folder/ZIP and Git default-main check/explicit-update gates separately. Reuse passing expensive results only when relevant inputs remain unchanged.
- [x] 4.3 Semantically review current documentation and the public diff for stale update/network claims, unsupported compatibility statements and private data. Validate this OpenSpec change strictly, resolve required independent review, and report remaining coverage limits without claiming unperformed native/platform checks.
