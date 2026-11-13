# native-extension-updates Specification

## Purpose
Rely on the host's actual installation/update flow while retiring redundant remote version awareness without breaking mixed-version clients.

## Requirements

### Requirement: Host-owned update discovery and action

Agent Progress SHALL leave extension update discovery, selection, approval and installation to OpenChamber. Current rail, Work Status and board guests MUST NOT request or display official-main availability, run its scheduler, or read/write its dismissal preference. They MUST NOT add a replacement update indicator, updater action or outbound version lookup.

#### Scenario: Normal and failed progress views
- **WHEN** current guests start, refresh, change session, return to visibility or show unconfigured/unavailable progress
- **THEN** none calls `/v1/extension-update` or renders the former notice/line
- **AND** progress reading, Setup and language controls retain their existing behavior

#### Scenario: New guest with an old service
- **WHEN** an older service supports the former checker or would return an available, missing or malformed update reply
- **THEN** the current guest never invokes that checker or derives update state from it
- **AND** unrelated supported progress/Setup behavior is not made dependent on update metadata

### Requirement: Network-free retained compatibility route

For at least one release, authenticated body-free, query-free GET `/v1/extension-update` SHALL retain the old response shape as unknown/unavailable with no candidate or successful check. It SHALL provide one-hour old-client backoff, not a future-check promise. The route and its initialization/shutdown MUST NOT perform external requests or mutate persistent data. Protocol/schema SHALL remain 2.

#### Scenario: Compatibility response fields
- **WHEN** an authorized valid compatibility GET succeeds
- **THEN** the reply contains the service release and unchanged fixed repository/ref fields, `state: unknown`, `checkedAt: null`, `stale: false`, `diagnostic: unavailable`, and no `candidateVersion`
- **AND** `nextCheckAt` is a finite ISO timestamp one hour after response construction, documented as compatibility backoff only

#### Scenario: Old guest consumes the replacement reply
- **WHEN** an unchanged pre-retirement parser and guest receive a successful compatibility reply
- **THEN** they accept the shape and show no available-version notice
- **AND** the reply does not imply a successful check or an up-to-date installation

#### Scenario: Store is unavailable
- **WHEN** the service is unconfigured or its progress store cannot be opened
- **THEN** an authorized compatibility GET still returns the same unavailable semantics with HTTP 200
- **AND** it neither opens/repairs a store nor invokes a metadata transport

#### Scenario: Invalid or unauthorized request
- **WHEN** the caller lacks the correct bearer, uses a non-GET method, supplies a query or sends a body
- **THEN** the existing fixed auth/method/query/body refusal behavior and no-store response policy remain
- **AND** there is no outbound request or persistent side effect

### Requirement: Version-qualified native update evidence

Acceptance SHALL exercise actual OpenChamber web 2.7.1 Git installation, automatic Settings check, explicit Check for updates and Update through a disposable real web UI. It SHALL record exact versions and candidate identity, distinguish source inspection and test seams from observations, and verify unchanged-permission retention and added-permission approval. No live profile, copied credentials, externally published Git fixture, paid model or real-instance restart SHALL be used.

#### Scenario: Same permissions and retained state
- **WHEN** the selected Git ref advances to a higher built package version without requesting more capabilities and the user explicitly updates
- **THEN** evidence shows the host Update available/action flow and absence of unnecessary reapproval
- **AND** grants, synthetic integration accounts/settings, paused state and installation storage identity are checked for retention
- **AND** Agent Progress's device preference, verified private binding and recorded history remain intact

#### Scenario: Additional capability approval
- **WHEN** a synthetic next version requests an additional capability
- **THEN** the real host's approval dialog and deferred/accepted states are exercised
- **AND** unapproved capability use remains unavailable
- **AND** evidence records whether files have already been replaced, without describing Not now as a rollback unless proven

#### Scenario: Cached and explicit checks
- **WHEN** Settings → Extensions is reopened after a successful check inside the hour window and Check for updates is then explicitly selected
- **THEN** observed Git operations distinguish cached reuse from the forced check
- **AND** the hour boundary is additionally exercised through the host checker's existing clock seam, with the seam labelled rather than presented as elapsed browser time

#### Scenario: Running service and loaded guests
- **WHEN** an update replaces an extension whose service and progress frames were already loaded
- **THEN** evidence records service stop/restart on subsequent access, frame package-revision remount behavior and resulting readable progress
- **AND** managed companion load observations are checked separately from installed version and frame refresh

### Requirement: Accurate source and update instructions

README and Setup SHALL describe only behavior supported by measured installer/update evidence: default-branch/main selection, explicit `#main` and `#dev`, fixed release tags, and manual folder/ZIP replacement. They SHALL explain that host offers are version-based rather than commit/byte-based, and SHALL NOT promise a README custom-scheme install button or untested platform behavior.

#### Scenario: Branch and tag selection
- **WHEN** disposable default, explicit-main, development-branch and tag installations are checked after their refs diverge
- **THEN** each follows its selected ref rather than another branch or the newest tag
- **AND** a same-version byte/commit change is not described as sufficient for an automatic host Update offer

#### Scenario: Folder or ZIP installation
- **WHEN** a folder or ZIP install is listed and update checking runs
- **THEN** it has no Git update offer
- **AND** instructions identify manual replacement/rebuild, without equating local folder watching with remote self-updating or promising Git-equivalent replacement retention

### Requirement: Observation-based managed reload wording

Managed update wording SHALL use existing Setup/Reporting health observations and retain English/Russian support. It SHALL distinguish unknown/not observed, matching and differing loaded bytes, keep mismatch warning-only, and condition reload/restart advice on known mode or observed limitations. It MUST NOT infer activity, universal activation or a separate companion update from an extension update.

#### Scenario: Update has no matching load observation
- **WHEN** new extension bytes are installed but a matching managed load is absent or differs
- **THEN** the UI explains the observation and applicable reload/restart caveat without claiming all sessions need or completed a restart
- **AND** it neither starts a restart nor adds an independent companion-update confirmation

#### Scenario: Matching or legacy observation
- **WHEN** a managed matching load is recorded or a legacy/recovery-only state is displayed
- **THEN** matching remains a load observation rather than a heartbeat or task completion
- **AND** legacy recovery retains its distinct safety and reload semantics rather than being silently treated as managed success

### Requirement: Coherent retirement delivery

Implementation SHALL include affected contract/setup/UI/backend/compatibility guides, README and contributor guidance, focused regression tests, built runtime entries and package/Git checks. Current guidance MUST NOT claim the retired network check still runs. Historical evidence MAY describe its original tested behavior when clearly historical. No new network call SHALL replace the retired one; host-managed Git traffic SHALL remain distinguished from extension-owned traffic.

#### Scenario: Built and mixed-version acceptance
- **WHEN** the generated candidate is tested against source/built service routes and old/new guest combinations
- **THEN** the current service makes zero outbound metadata attempts and current guests make zero compatibility-route calls
- **AND** actual browser screenshots cover the three views and affected observation states
- **AND** distribution checks prove matching tracked generated entries without a consumer build
