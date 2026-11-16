## MODIFIED Requirements

### Requirement: Cheap honest health and nonblocking admission

Authenticated health SHALL return a cheap last-observed liveness/admission snapshot without security queries or legacy discovery. Starting or unverified state MUST NOT be presented as fresh Store authority. Migration, fresh configuration and data access SHALL obtain required fresh admission on demand without synchronous security work blocking the health-serving event loop. Fresh inspection, effects, controls and status SHALL reuse the existing request-driven worker boundary, not an autonomous job.

#### Scenario: Cold legacy upgrade
- **WHEN** the service starts with a released legacy installation and no managed selection
- **THEN** health responds without opening/adopting the legacy store or spawning security helpers
- **AND** Setup and background composer access can request admission rather than treating starting as permanently unavailable

#### Scenario: Slow security work is active
- **WHEN** a migration, fresh-setup or admission request performs a cold, slow or failing security query
- **THEN** a concurrent authenticated health request remains responsive and honest
- **AND** scheduling main-thread spawnSync through a timer or Promise is not treated as nonblocking

#### Scenario: No fresh store yet
- **WHEN** a fresh operation has prepared its journal but has not created its store
- **THEN** status shows the durable pending operation with unknown capture and no configured binding
- **AND** observation neither creates storage nor treats planned absence as a corrupt existing database

### Requirement: Bounded separate setup requests

Each migration or negotiated fresh-setup step SHALL be a separate request driven by Setup, with at most six actual security-process spawns including retries, validation, mutation, diagnostics and cleanup. The 2.5-second-per-spawn planning assumption yields 15 seconds of security work plus 5 seconds of headroom under the host's 20-second limit. Inspection/status SHALL be trimmed or continued to meet the same budget. Work and response deadlines SHALL remain 17 and 18 seconds respectively; deadline exhaustion SHALL be explicit rather than weakening checks. Fresh store-directory creation, database initialization and source registration MUST NOT be hidden inside an already full preparation request.

#### Scenario: A phase exceeds the request budget
- **WHEN** inspection, creation, record publication, removal or final status cannot fit after its fresh validation
- **THEN** the work is split at a safe durable boundary or refused without skipping required validation
- **AND** Setup receives bounded progress and explicitly drives the next request rather than one long background operation

#### Scenario: Helper exceeds the planning assumption
- **WHEN** a helper is slower than assumed or fails within the service's below-host deadline
- **THEN** the request stops admitting further work and reports pending, uncertain or failed effects honestly
- **AND** no unbounded cold retry or misleading rollback/success claim occurs

#### Scenario: Supported migration on a slow machine
- **WHEN** the supported legacy fixture is inspected and migrated with helper latency around the 2.5-second-per-spawn assumption
- **THEN** the full switch completes successfully through separate requests below the 20-second host limit and within the six-spawn ceiling
- **AND** repeated bounded refusals are not accepted as successful migration

#### Scenario: Fresh setup on a slow machine
- **WHEN** a supported Windows fixture has no legacy install, managed journal or store and helpers take 2.5 seconds per launch
- **THEN** reviewed fresh setup completes with a valid selected Store/source and verified capture through requests below twenty seconds and within six launches each
- **AND** repeated bounded refusals do not count as successful setup
- **AND** persistent slower-helper exhaustion is a bounded recovery refusal, not a guarantee of eventual completion

### Requirement: Fresh authority for every mutation step

Every step SHALL freshly validate its current target, consent/sequence, ownership, privacy, path safety, relevant files and Store/source identity before its mutation. Previous discoveries and durable progress MUST NOT replace current security checks. Full legacy ownership and existing removal safeguards SHALL remain, with no ACL cache across requests or mutations. Fresh creation SHALL validate absence and frozen proposed identity where objects do not yet exist, and freshly validate resulting objects before further effects. Proposed identities MUST NOT authorize ordinary selected-binding or companion admission.

#### Scenario: State changes between steps
- **WHEN** an ACL, path object, manifest, source/store, reviewed selection or operation sequence changes
- **THEN** the next affected mutation refuses before acting on stale authority
- **AND** no foreign bytes, history or existing locks are removed to force progress

#### Scenario: Object appears at a reviewed absent target
- **WHEN** a directory, database, sidecar or selector appears without this operation's sufficient creation evidence
- **THEN** the next effect refuses rather than adopting, replacing or initializing that object
- **AND** a copied journal or matching path alone is not authority

### Requirement: Durable resumable idempotent steps

Migration and fresh setup SHALL retain private pending/progress records and sufficient intent/completion evidence between requests. Identical current-step retry SHALL reconcile actual durable effects without repeating side effects. Restart/interruption SHALL permit explicit same-target resume with fresh validation and single-writer fencing; changed, reordered or competing requests SHALL not advance stale progress. Fresh setup SHALL use an explicitly discriminated format-3 journal at the existing location, without fabricated legacy identity or removal evidence. Format-1 recovery and format-2 migration behavior SHALL remain supported unchanged. Partial creation that cannot be proven safe SHALL be retained and refused, not repaired or adopted.

#### Scenario: Reply lost after mutation
- **WHEN** the current step committed an effect but its reply was lost
- **THEN** retry returns the reconciled committed state without duplicate creation, source registration, removal, binding or capture changes
- **AND** a completed enable replay does not override a later user disable

#### Scenario: Restart or writer interruption
- **WHEN** the service or Setup frame stops between steps or during a mutation boundary
- **THEN** retained progress is shown and explicit resume reconciles the same target safely
- **AND** unknown/foreign locks or unsupported journal formats fail closed rather than being silently deleted or treated as absent

#### Scenario: Older code reads a fresh journal
- **WHEN** an older service or migration-only request encounters format 3
- **THEN** it refuses unsupported progress rather than treating it as absence or a legacy migration
- **AND** rollback retains the journal, selection and data without down-conversion or global-loader restoration

#### Scenario: A response deadline leaves a worker active
- **WHEN** a fresh effect outlives its response deadline
- **THEN** the existing target/Store fence remains held until actual settlement or positively established fencing
- **AND** a competing writer is refused, with no timeout-based takeover or rollback inference

### Requirement: Honest capture and cancellation semantics

Before confirmation, cancelling inspection SHALL make no product changes. After confirmation, pause/abandonment SHALL stop further steps after the current request settles, retain progress and not imply rollback. Capture on/off/unknown and pending recovery SHALL remain explicit at every step and failure. Pause, failure or restart MUST NOT continue work, re-enable capture or restore a global loader automatically. New stores SHALL initialize capture off atomically and enable only through their confirmed enable step after prerequisites. Retained-store reconnection SHALL preserve the current capture setting and contain no enable/disable effect.

#### Scenario: Pause before or after capture disable
- **WHEN** the user pauses or closes Setup during migration
- **THEN** the earlier capture state remains before disable, or off/unknown is visibly retained after disable with a resume action
- **AND** a pending journal alone does not prove capture is off or migration complete

#### Scenario: Successful completion
- **WHEN** all validated transition effects and any authorized enable step have durably completed
- **THEN** Setup reports completion with the verified capture observation
- **AND** matching managed-load observation remains a separate fact

#### Scenario: Pause during new-store setup
- **WHEN** Setup is paused before its authorized enable step
- **THEN** an absent/unverified store is shown with unknown capture, or a verified initialized store with capture off
- **AND** closing/reopening preserves the warning and requires explicit continuation

#### Scenario: Uncertain enable and later user disable
- **WHEN** a fresh enable has no durable completion proof and capture is now off
- **THEN** ordinary resume/replay cannot silently enable it
- **AND** a freshly reviewed single-use capture decision is required under the existing renewal rules

### Requirement: Precise accessible progress and compatibility refusal

Setup SHALL show actual step progress, pending/paused state, fixed last-action stage/code, capture observation and recovery actions in English, Russian and Simplified Chinese at phone width with accessible focus/announcements. Fresh progress SHALL reflect its frozen plan and creation/reconnection consequences, not the fixed legacy removal-stage count. The service SHALL advertise fresh support independently as `managedFreshSteps: 1` in authenticated health and Setup delivery. Fresh requests SHALL use version 2 on the existing step route; version-1 migration shapes and capability SHALL remain unchanged. Old single-request migration input and old Windows inspect/configure input SHALL receive a fast non-mutating compatibility refusal. New UI SHALL negotiate fresh support rather than fall back to an unsafe long request.

#### Scenario: Older UI or service
- **WHEN** an older UI sends the old migration input to the new service
- **THEN** the old URL returns HTTP 409 with managed-action-required before migration work, using the existing update-together guidance
- **AND** the new UI sends no step mutation to an older service that lacks the corresponding capability

#### Scenario: Failure or retired context
- **WHEN** a step fails or the host/source changes while a response is outstanding
- **THEN** allowlisted diagnostics remain visible without private/raw error content and retired replies cannot resume the driver
- **AND** no invented percentage, completion claim or additional polling loop replaces actual step results

#### Scenario: Older fresh client on Windows
- **WHEN** an authenticated caller posts old managed-inspect or managed-configure input to the new Windows service
- **THEN** it receives HTTP 409 with exactly the existing managed-action-required error object
- **AND** no security helper, worker or product write occurs

#### Scenario: Non-Windows compatibility
- **WHEN** an older caller uses the old fresh routes on Linux or macOS with no legacy discovery or journal
- **THEN** the existing nonce-bound confirmation and writer-fenced fresh path remains supported
- **AND** any journal or legacy/conflicting state retains its existing no-write refusal

#### Scenario: Fresh capability absent
- **WHEN** the new UI needs fresh setup but the service does not advertise managedFreshSteps version 1
- **THEN** it shows update-together guidance and sends neither fresh mutation nor automatic old-route fallback
- **AND** independently supported migration and capture controls are not disabled merely by this missing capability

#### Scenario: Reopen fresh progress
- **WHEN** Setup observes a format-3 operation through delivery.freshProgress
- **THEN** the existing driver/card offers the explicit appropriate recovery action and displays its actual plan
- **AND** migrationProgress retains its version-1 shape for older consumers

### Requirement: Native Windows responsiveness evidence

Acceptance SHALL include native Windows released-legacy migration and fresh setup over authenticated HTTP, per-request spawn ceilings, sanitized per-step traces and concurrent health checks. Undelayed CI requests SHALL take at most 8 seconds, providing more than twofold margin to the host timeout. Delayed tests SHALL meet the below-host deadline instead. Native effect/recovery evidence and browser screenshots SHALL accompany logic checks. Portable fake-spawn tests SHALL count actual launch attempts for each new step, including errors and replay, but MUST NOT be described as native Windows measurements.

#### Scenario: CI verifies the built candidate
- **WHEN** the final built service migrates an isolated released 1.1.1 installation under a non-admin Windows test principal
- **THEN** inspect, step, failure, retry and status paths meet the spawn/time bounds with retained identities/history and honest capture state
- **AND** traces contain only bounded stage/code/timing/count/state facts, never account names, paths, credentials or raw logs

#### Scenario: CI verifies empty-store setup
- **WHEN** the built candidate starts with only isolated config/data roots and no legacy, managed directory, store or journal
- **THEN** undelayed and 2.5-second-helper fresh journeys complete within their respective request bounds
- **AND** concurrent health uses zero security launches and responds within the existing 1.25-second native health bound
- **AND** representative restart, dropped-reply, pause/resume, retained reconnection and over-budget cases assert actual durable effects

#### Scenario: Rendered fresh Setup
- **WHEN** current-source guests run the fresh journey in the existing rendered browser harness
- **THEN** screenshots and interaction checks cover review, running creation, paused off/unknown, failure/recovery and completion in EN/RU/zh-CN at phone width
- **AND** keyboard acknowledgement/confirmation, focus return and context retirement remain operable without private fixture data

## ADDED Requirements

### Requirement: Fresh review binds proposed creation and retained identity

Fresh confirmation SHALL bind the inspected target, create/retain choices, identities, package expectation, capture consequence and ordered plan through the existing nonce/digest pattern. Begin SHALL require explicit acknowledgement after review. Inspection SHALL write no product state; mutation inputs MUST NOT accept replacement paths or identities.

#### Scenario: New store review
- **WHEN** the selected safe store is absent and no legacy install or conflicting journal exists
- **THEN** the review identifies storage/source creation and eventual capture enable, with proposed identities bound privately to that review
- **AND** neither inspection nor cancellation creates a directory, database, source or binding

#### Scenario: Consent facts change
- **WHEN** target, reviewed object/absence, source facts, package bytes, plan or operation context changes before confirmation
- **THEN** begin refuses stale consent before effects
- **AND** a restart without a durable begin receipt requires fresh inspection rather than trusting an expired token

#### Scenario: An operation already exists
- **WHEN** inspection discovers an unfinished same-target fresh operation
- **THEN** Setup offers its explicit recovery action rather than a second begin
- **AND** another operation cannot replace its consent or target

### Requirement: Fresh bootstrap preserves refusal boundaries

Fresh preparation SHALL reuse existing directory and private-publication owners. Creation and source registration SHALL have budgeted intent/completion boundaries. A new database SHALL atomically initialize its frozen Store ID and capture-off value without a progress schema change. Unproven partial creation SHALL be retained and refused, never automatically adopted, cleaned or repaired.

#### Scenario: Managed directory exists without a valid marker
- **WHEN** a crash leaves the managed directory created but its marker absent or invalid
- **THEN** prepare refuses with a fixed diagnostic and retains the directory
- **AND** its emptiness or private permissions do not authorize adoption

#### Scenario: Marked directory without a journal
- **WHEN** the managed directory and marker are valid and private but no journal was published
- **THEN** fresh same-target validation and confirmation may publish the initial journal
- **AND** this does not authorize adopting an unmarked directory or ambiguous staging

#### Scenario: Store creation interrupted
- **WHEN** a store-directory completion or database initialization cannot be proven from the same operation's durable evidence and fresh checks
- **THEN** the partial state is retained with an explicit recovery refusal and no binding/enable effect
- **AND** a completed database initialization may be reconciled only against the frozen Store identity, supported schema and expected pre-registration state, without a writable repair

#### Scenario: Ambiguous publication or sidecars
- **WHEN** interrupted creation leaves ambiguous stages, publication links or orphan database sidecars
- **THEN** Setup refuses and retains them for separately authorized diagnosis
- **AND** it does not delete or repair them to make creation succeed

### Requirement: Retained fresh reconnection preserves data and capture

Fresh setup SHALL support explicitly chosen valid retained stores, preserving identifiers, history, reports, receipts and capture. It SHALL reuse an unambiguous verified matching source or register a disclosed new source after expectation publication. Reconnection MUST NOT recreate storage, invent removal history, alter unrelated sources or change capture.

#### Scenario: Retained store with capture off
- **WHEN** the user reconnects a valid retained store whose capture is off
- **THEN** the completed binding selects that same store and source with capture still off
- **AND** completion does not imply that capture was enabled or the companion loaded

#### Scenario: New source in retained storage
- **WHEN** the reviewed retained store has no source for the selected canonical roots
- **THEN** confirmation binds a new source identity and expectation publication precedes its idempotent registration
- **AND** existing sources, data and capture remain unchanged
