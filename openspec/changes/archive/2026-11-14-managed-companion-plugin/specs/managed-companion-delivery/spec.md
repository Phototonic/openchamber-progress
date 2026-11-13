# Spec Delta

## Purpose

Deliver capture with the approved OpenChamber extension while retaining explicit data authority, safe legacy migration and honest observation/lifecycle limits.

## ADDED Requirements

### Requirement: Approved managed plugin delivery

The extension SHALL declare the existing companion directory through `contributes.opencodePlugin`. It SHALL retain OpenChamber `>=2.7.1`, SDK 2.7.0 and plugin-delivered skill/guidance. Capture MUST NOT require a new permanent global plugin, global configuration edit, consumer build or dependency download.

#### Scenario: Supported fresh install
- **WHEN** a user installs the distribution on a fresh supported managed host and approves the plugin capability
- **THEN** OpenChamber delivers the shipped companion folder to its managed OpenCode
- **AND** after explicit valid store configuration, a new eligible session can report through the unchanged tool and the rail, Work Status and board display that reported progress

#### Scenario: Approval denied or host too old
- **WHEN** plugin approval is withheld, host policy disallows it, or the host is below 2.7.1
- **THEN** no global-plugin fallback or authority bypass occurs
- **AND** a below-floor host refuses installation with its normal host-version feedback

### Requirement: Single private verified binding

Service and managed companion SHALL discover the same single descriptor in a dedicated product-owned subfolder of the canonical OpenCode data root derived from XDG data/HOME. They SHALL preserve marker, canonical-path, ownership, private-mode or equivalent ACL, binding and Store/source validation. They MUST NOT scan roots, fall back from invalid state, auto-adopt legacy selectors or put private state in the extension code folder.

#### Scenario: Service environment omits state root
- **WHEN** the service lacks `XDG_STATE_HOME` and an explicit binding variable but shares the supported XDG data root with managed OpenCode
- **THEN** both resolve the same owned descriptor and verify the same store/source without duplicate descriptor copies

#### Scenario: Missing selection
- **WHEN** the descriptor is absent and setup or a dormant companion is inspected
- **THEN** the state is unconfigured and no directory, ownership marker, descriptor or store is automatically created or adopted

#### Scenario: Invalid selection
- **WHEN** the selected directory, marker, descriptor, source scope or Store is invalid, modified, aliased, foreign, non-private or unsupported
- **THEN** capture fails closed and existing bytes remain intact
- **AND** a present invalid selection is not treated as absence or permission to try another root

### Requirement: Explicit configuration without global installation

The normal setup journey SHALL review managed source identity, private store, privileges and lifecycle before a confirmed configuration. It SHALL preserve verified/unverified distinctions, existing source identifiers and explicit custom-store choice. It MUST NOT infer effective runtime identity from path existence, project location or service environment alone.

#### Scenario: Confirmation and deferred activation
- **WHEN** the plugin was delivered before a descriptor existed and the user later confirms a valid configuration
- **THEN** a subsequent eligible native context/tool boundary can initialize the verified companion without a global install or automatic host restart
- **AND** concurrent initialization does not create duplicate tools, guidance, observers or writers

#### Scenario: Changed or unsupported scope
- **WHEN** an active runtime's binding identity changes or its effective scope uses an unsupported override
- **THEN** it refuses or retires the affected runtime authority rather than silently selecting another store
- **AND** UI source association does not become verified merely because a store was found

### Requirement: Fully validated one-confirmation legacy migration

For at least one release, Setup SHALL offer one explicitly confirmed switch from a fully validated legacy installation to managed delivery. Detection SHALL use the existing full ownership checks, and removal SHALL use `remove-capture`. Migration SHALL preserve the same store/source and all retained history; it MUST NOT proceed on store/source mismatch or alter foreign/modified files.

#### Scenario: Matching legacy installation
- **WHEN** the user confirms migration of a fully validated same-target legacy install
- **THEN** the operation disables capture, removes only its verified global discovery files, durably selects the managed binding and enables capture only after those steps succeed
- **AND** identifiers, reports, receipts, captures, cleanup protections and retained payload/history remain available
- **AND** successful file removal is not itself claimed as a matching managed-load observation

#### Scenario: Different store or false ownership
- **WHEN** a legacy path exists but fails full ownership validation, or its store/source differs from the selected managed binding
- **THEN** migration refuses before disabling or removing that installation or adopting its data
- **AND** the user receives actionable conflict feedback rather than automatic takeover

#### Scenario: Interrupted or repeated migration
- **WHEN** migration fails after disabling/removing capture, or a request is repeated after an uncertain response
- **THEN** status reflects the actual partial/completed same-target state with history intact
- **AND** safe explicit retry revalidates ownership/identity without duplicate removal, automatic re-enable, foreign staging cleanup or global-loader restoration

#### Scenario: Legacy still active
- **WHEN** a legacy winner remains loaded or an independent legacy/global entry is still installed
- **THEN** the extension does not claim its toggle controls that copy or that managed activation succeeded
- **AND** it explains explicit migration/removal and any necessary user-initiated reload without automatically restarting runtimes

### Requirement: Mode-qualified capture lifecycle

In watched managed-file mode, extension disable/removal SHALL retire the managed companion and stop subsequent capture; re-enable SHALL reuse valid retained state. Environment-content fallback SHALL be documented as requiring restart. External/remote/terminal/isolated/VS Code runtimes SHALL not be claimed as managed capture coverage. Legacy or explicit global entries SHALL remain identified as independent exceptions. History MUST NOT be purged.

#### Scenario: Disable, re-enable and removal
- **WHEN** a configured watched-file installation is disabled, re-enabled and then removed in a disposable host
- **THEN** later eligible reports stop after disposal, resume after reactivation and stop after removal
- **AND** existing progress remains readable from the retained store, with no purge or secure-erasure claim

#### Scenario: Fallback or unknown mode
- **WHEN** the caller owns `OPENCODE_CONFIG`, or the extension cannot establish the delivery mode
- **THEN** UI and documentation explain restart-dependent or conditional lifecycle instead of promising an immediate live stop

#### Scenario: Closing a view
- **WHEN** the user closes a progress view without disabling the extension
- **THEN** it is not represented as disabling capture

### Requirement: Safe retirement of held reporting work

Disposal SHALL retire pending initialization and report authority before awaited teardown. Work held across retirement MUST NOT commit a late report or captured document. This SHALL preserve the existing report error contract and SHALL NOT promise graceful session cancellation.

#### Scenario: Permission wait during disable
- **WHEN** a report waits for document-read permission and the managed companion is disposed before the permission completes
- **THEN** releasing the permission does not commit that report/capture
- **AND** any fixed failure and session-completion limitation are reported honestly; testing does not wait indefinitely or claim the session necessarily settles

### Requirement: Warn-only managed fingerprint comparison

The service SHALL record an expected managed companion fingerprint in the private progress-store directory without a database schema change. The companion SHALL record its successful loaded observation using its actual runtime release identity. Status SHALL distinguish missing, matching and differing observations. Fingerprint mismatch alone MUST NOT block startup or reporting; binding, schema, control and permission safeguards SHALL remain enforced.

#### Scenario: Different loaded bytes at the same version
- **WHEN** a valid companion loads bytes differing from the recorded expectation while retaining the same version label
- **THEN** status shows a loaded-bytes warning and an otherwise authorized report can still succeed
- **AND** no version-only match or hash-attested-execution claim is made

#### Scenario: Expected observation unavailable
- **WHEN** the expected metadata or matching loaded observation is absent or unreadable
- **THEN** status remains unknown/not observed rather than claiming matching bytes, recent activity or tool availability
- **AND** no missing store is recreated by an observation read

### Requirement: Honest reporting observations and mixed consumers

Managed setup SHALL have an explicit discriminated contract understood by the matching service/UI. Reporting health SHALL separately explain package delivery, last matching loaded observation, capture control, selected recorded revision and viewer freshness. It MUST NOT use service OpenCode-provider permissions as plugin inventory, treat a load as a heartbeat, or infer progress/completion. Existing bounded checks, source association, retirement and support-summary privacy SHALL remain.

#### Scenario: No current tool inventory
- **WHEN** a matching loaded observation and stored enabled flag exist but current per-session tools are unknown
- **THEN** the UI labels those as observations rather than asserting every session or restricted child has the tool
- **AND** support output contains fixed classifications, not fingerprints, paths, IDs or raw errors

#### Scenario: Older service
- **WHEN** the new UI receives a setup reply without the managed-delivery revision
- **THEN** it treats that reply as legacy/unsupported for managed actions and does not fabricate managed activation or send new mutations

### Requirement: Explicitly weaker integrity and update contract

The guides SHALL state that host-managed executable folders are not the former private hash-attested immutable payloads. They SHALL distinguish publisher authenticity from observational fingerprints and host update selection from former per-companion confirmation. Managed code updates MUST NOT be described as gap-free atomic swaps or universal private-mode installs. The separate official-version notice SHALL remain unchanged by this work.

#### Scenario: Host update or rollback
- **WHEN** the host replaces the extension or the user restores an earlier build
- **THEN** companion bytes follow host delivery and runtime activation remains separately observed
- **AND** private data is retained without schema downgrade, automatic snapshot restoration or reinstallation of global capture

### Requirement: Distribution and behavioral evidence

Folder, ZIP and Git distributions SHALL include the declared resolvable plugin directory and matching regenerated entries in package/parity checks. Updated README and setup/contracts/backend/UI/compatibility guides SHALL ship with implementation. Managed configuration/migration and reporting-health controls SHALL retain English/Russian accessibility behavior. Acceptance SHALL include real disposable-host/browser journeys and a resolved independent trust-boundary review.

#### Scenario: Built distribution acceptance
- **WHEN** the accepted built candidate is installed on an isolated 2.7.1 host with credential-free local scripted reporting
- **THEN** plugin approval, reporting in all three views, lifecycle, legacy migration, retained history and below-floor installer refusal have behavioral evidence
- **AND** screenshots and diagnostics use synthetic content, with unavailable platform coverage explicitly identified rather than certified
