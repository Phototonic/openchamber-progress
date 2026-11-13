# Design

## Evidence and boundaries

`service/server.ts` authenticates the update route before Setup/store access. `ExtensionUpdates` owns its outbound fetch, cache, ETag, timers and shutdown. `ui/shared/adapter.ts` accepts only the existing state/diagnostic vocabulary, a finite ISO `nextCheckAt`, and consistent unknown-state fields. `officialMainNotice` displays only `available`; old frame scheduling clamps retries to 5–60 minutes. Consequently a new `retired` enum or removed required field is less compatible than the existing unavailable shape.

`scripts/verify-git-package.ts` already exercises the real host installer/updater with a local bare Git repository, controlled name resolution and a constrained Git wrapper. It currently couples that proof to the extension's official-main checker; remove that coupling, not the host/distribution checks. `scripts/verify-live-package.ts` similarly mixes metadata and unrelated timing proof; retain the latter.

Published OpenChamber 2.7.1 source establishes Git-only version checks, an hour cache with explicit force, stored ref selection, same-ID state retention and service stop before replacement. Its route announces a package revision change; host documentation describes frame reload. Source also says added capabilities leave the new package unapproved until reviewed: an approval deferral is not necessarily a rollback to old executable files. Existing managed-host acceptance covers watched delivery and restart-dependent caller-owned configuration, but is not fresh proof of the Git-update journey. Native execution in this change must establish those observations before the guides describe them as tested.

Current upstream [extension documentation](https://github.com/openchamber/openchamber/blob/main/packages/docs/content/docs/extensions.mdx) agrees with the general flow, but mutable documentation does not certify a particular release. Record actual host, native runtime, browser, toolchain and candidate identity in acceptance results.

## Decisions

### 1. Remove all duplicate update presentation

Adopt full removal, not a compact Work Status fallback. The host can check the installation's actual origin; the extension cannot. A smaller duplicate notice would retain the same provenance ambiguity and network dependency. Existing Setup and Reporting health remain the owners of local delivery/load observations, not remote version discovery. This decision is reversible in a separately justified change, but no dormant checker or feature flag is retained.

Remove the official controller state, scheduler/readiness hooks, dismissal storage activity, source reader, unused mapping/model/link/style and presentation consumers where no longer used. Leave the obsolete dismissal key inert: do not add a storage migration or clear any broader namespace. Preserve progress refresh, language preference, height synchronization, focus and Setup behavior.

### 2. Keep the old wire shape, with no network implementation

For at least one release, retain the route, authentication, no-store response headers, body/query/method refusals and independence from store readiness. Return HTTP 200 with:

- `installedVersion`: the service's existing `RELEASE`;
- `repository` and `ref`: the existing fixed contract literals, unchanged;
- `state: 'unknown'`, `checkedAt: null`, `stale: false`;
- no `candidateVersion`;
- `diagnostic: 'unavailable'`;
- `nextCheckAt`: a finite ISO timestamp one hour after response construction.

The last field is compatibility backoff for old guests, not a promise that the service will check later. Do not invent a successful check, an up-to-date claim, a future enum, an extreme date sentinel or a candidate. No remote access, cache, ETag, transport configuration, background timer or store/config write is needed to construct this reply. The existing DTO can remain as a deprecated compatibility type; deleting internal checker machinery does not require deleting the route/type.

An old guest accepts this reply and displays no notice after its next successful read. A cached old banner can remain until then or until the host remounts its frame; do not promise instantaneous removal from already-loaded old JavaScript. New guests do not call the route at all, including against an older service that would return `available`, 404 or malformed data. The old service's checker was request-driven, so new guests do not trigger it. An old service paired with an old guest remains old behavior and is outside the new code's control.

Deleting the route later requires a separate compatibility decision after the retention window; no timer, release-number test or automatic removal is introduced. Protocol/schema versions and unrelated Setup DTOs do not change.

### 3. Host update and activation are different observations

Use the normal Settings → Extensions check and explicit Update action. Verify that an unchanged-permission update retains grants, accounts, settings, paused state and installation storage identity, and that an added-capability update requests approval before effective use. Inspect deferral and later approval; never describe declining approval as reverting files unless observed. Do not replace host approval with an extension confirmation.

Managed companion bytes ship with the extension. Keep unknown/not observed, matching and differing loaded-byte states; differences remain warning-only when binding/control/permission gates otherwise permit reporting. Refine English/Russian copy through `managed-copy.ts` and existing reporting-health presentation, without a second companion-updater workflow. Explain an unobserved or differing load as an observation, not proof that a restart is always needed. Explain reload/restart conditionally using measured watched-file behavior, caller-owned-config fallback and legacy exceptions. Never automatically restart OpenCode or claim every running session loaded new code.

Retain explicit legacy/recovery-only wording and controls where still supported. This work does not delete migration/removal utilities or reinterpret their `reload-required` state as managed success.

### 4. Explain refs and delivery without overstating update eligibility

README and Setup should describe a no-fragment URL following the remote default branch (main for this distribution), `#main` as explicit branch selection, `#dev` as development-branch selection, and a published `#vX.Y.Z` as tag selection. A branch is not an immutable commit pin; a fixed tag does not follow later release tags. Verify representative refs with the actual installer/updater.

The host compares the selected ref's package version, not commits or byte differences. In particular, same-version development commits do not automatically produce an Update offer. Folder and ZIP installations have no Git update discovery; users replace/rebuild them manually. Folder file watching is not remote self-updating. Keep that distinction and do not equate ZIP replacement's retention/approval behavior with Git update.

Do not add a README custom-scheme button or a new landing page. The copyable Git URL and Settings path suffice; no working GitHub button is established. Any future `openchamber://extensions/install?url=` link needs a controlled page and actual launch/approval evidence before it is offered. This avoids turning an optional convenience into new hosting/deep-link scope.

### 5. Reuse isolated native and browser test boundaries

Extend the existing Git gate and reuse the managed-host and real-web browser driver patterns. Run unchanged published host modules under fresh synthetic HOME/all XDG roots, a fresh browser profile and loopback-only isolation, with an independent native executable and credential-free local scripted reporting only when reporting proof needs it. Local Git commits/version variations exist only in disposable projections, never in the product manifest.

The real host rejects private/loopback Git URL targets. Reuse the gate's narrow transport mapping to a local bare remote: a single allowlisted synthetic public-looking origin, test-only DNS resolution, and a constrained executable Git wrapper. The host's explicit Git-binary override is usable for the actual web route. Keep policy rejection checks, use real Git operations, and fail closed on any unapproved destination. No production policy edit, external publishing or credential helper is allowed. Label the mapping in results: this proves the host flow, not public GitHub reachability.

Measure Settings re-open versus explicit Check for updates using fetch counters. Exercise the hour boundary with the host checker's existing clock input in an isolated module test rather than waiting an hour or patching production time. Keep rendered-UI evidence for the actual automatic/forced checks, Update and approval states. Source-only cache timing is not a rendered hour-long observation.

For host-owned account/settings retention absent from Agent Progress's manifest, use a minimal test-only integration variant and synthetic records in the disposable host. Do not add a shipping integration contribution or perform real OAuth. Verify actual persistence through public host operations where supported; narrowly seeded records must be explicitly labelled fixture inputs. Test Agent Progress device language and progress store/binding/history retention separately.

## Failure, rollout and rollback

Ship matching service and guest outputs. Existing old/new pairings must remain usable; the compatibility route is not contingent on a usable progress store. Invalid/auth-denied calls retain their original fixed failures. A host fetch/update failure must not be converted into a false extension success, and failure before replacement must preserve the previous usable package/state as the existing Git gate asserts.

No data migration, reset, snapshot restoration, config deletion or global installation accompanies deployment or rollback. A forward correction preserving the retired route is preferable. Restoring an older service and older guests can restore the old metadata request and notice; disclose that network regression instead of claiming rollback remains network-free. Retained dismissal data requires no repair.

If measured host behavior contradicts retention or approval safety, stop affected delivery and report the evidence for amendment; do not bypass consent, silently add a replacement updater or publish unsupported guarantees. Mere reload/platform limitations can be documented precisely without expanding the product.

## Documentation and validation

The guides remain the contract of record. Replace current official-main sections and obsolete separate-companion wording in README, contracts, backend, UI, Setup and the relevant CONTRIBUTING paragraph. Add a dated, version-qualified native update section to compatibility; keep explicitly historical results as historical, not current advice. Do not erase historical changelog/evidence merely because it names the former checker.

Acceptance combines authenticated source and built-service requests with zero outbound attempts; old/new consumer tests; rendered all-three-view absence and managed observation states; actual host Git/install/check/update/approval/ref/ZIP/folder journeys; persisted synthetic state comparisons; generated-entry parity and package checks. Screenshots and published excerpts use only synthetic content. Static searches locate obsolete guidance but do not substitute for semantic documentation review or behavioral proof.

## Open Questions

None for authoring. Native behavior, generated artifacts and independent review remain execution gates, not already-completed evidence.
