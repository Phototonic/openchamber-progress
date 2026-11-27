# windows-setup-responsiveness Specification

## Purpose
Keep Windows service health responsive and support legacy migration and fresh configuration through bounded, freshly validated Setup requests with durable progress, explicit resume and honest capture/error reporting. Both paths preserve ownership, privacy and mutation safeguards.

## Requirements

### Requirement: Cheap honest health and nonblocking admission

Authenticated health SHALL return a cheap last-observed liveness/admission snapshot without filesystem validation or legacy discovery. Starting or unverified state MUST NOT be presented as fresh Store authority.

#### Scenario: Admission and worker boundaries
- **WHEN** migration, fresh configuration or data access needs admission
- **THEN** required fresh admission SHALL be obtained on demand without blocking the health-serving event loop
- **AND** fresh inspection, effects, controls and status SHALL reuse the existing request-driven worker boundary, not an autonomous job

#### Scenario: Cold legacy upgrade
- **WHEN** the service starts with a released legacy installation and no managed selection
- **THEN** health responds without opening/adopting the legacy store or starting any process
- **AND** Setup and background composer access can request admission rather than treating starting as permanently unavailable

#### Scenario: Slow security work is active
- **WHEN** a migration, fresh-setup or admission request is running
- **THEN** a concurrent authenticated health request remains responsive and honest
- **AND** no permission check starts a process, so none can block that request

#### Scenario: No fresh store yet
- **WHEN** a fresh operation has prepared its journal but has not created its store
- **THEN** status shows the durable pending operation with unknown capture and no configured binding
- **AND** observation neither creates storage nor treats planned absence as a corrupt existing database

### Requirement: Bounded separate setup requests

Each migration or negotiated fresh-setup step SHALL be a separate request driven by Setup, bounded by a 17-second work deadline and an 18-second response deadline below the host's 20-second limit. No step starts a process; deadline exhaustion SHALL be explicit rather than weakening checks.

#### Scenario: Request deadline allocation
- **WHEN** a request is admitted
- **THEN** work and response deadlines SHALL remain 17 and 18 seconds respectively, and no step starts a process
- **AND** inspection/status SHALL be trimmed or continued to meet the same deadlines
- **AND** fresh store-directory creation, database initialization and source registration MUST NOT be hidden inside an already full preparation request

#### Scenario: A phase exceeds the request budget
- **WHEN** inspection, creation, record publication, removal or final status cannot fit after its fresh validation
- **THEN** the work is split at a safe durable boundary or refused without skipping required validation
- **AND** Setup receives bounded progress and explicitly drives the next request rather than one long background operation

#### Scenario: Helper exceeds the planning assumption
- **WHEN** a request runs past its work deadline, for example on a slow disk
- **THEN** the request stops admitting further work and reports pending, uncertain or failed effects honestly
- **AND** no unbounded retry or misleading rollback/success claim occurs

#### Scenario: Supported migration on a slow machine
- **WHEN** the supported legacy fixture is inspected and migrated
- **THEN** the full switch completes successfully through separate requests below the 20-second host limit with no process started
- **AND** repeated bounded refusals are not accepted as successful migration

#### Scenario: Fresh setup on a slow machine
- **WHEN** a supported Windows fixture has no legacy install, managed journal or store
- **THEN** reviewed fresh setup completes with a valid selected Store/source and verified capture through requests below twenty seconds with no process started
- **AND** repeated bounded refusals do not count as successful setup
- **AND** persistent deadline exhaustion is a bounded recovery refusal, not a guarantee of eventual completion

### Requirement: Fresh authority for every mutation step

Every step SHALL freshly validate its current target, consent/sequence, canonical path, links, relevant files and Store/source identity before its mutation. Previous discoveries and durable progress MUST NOT replace current checks. Windows applies no ACL or ownership query.

#### Scenario: Fresh creation authority
- **WHEN** a step creates an object
- **THEN** full legacy ownership-of-content and existing removal safeguards SHALL remain, and nothing is cached across requests or mutations
- **AND** fresh creation SHALL validate absence and frozen proposed identity where objects do not yet exist, and freshly validate resulting objects before further effects
- **AND** proposed identities MUST NOT authorize ordinary selected-binding or companion admission

#### Scenario: State changes between steps
- **WHEN** a path object, manifest, source/store, reviewed selection or operation sequence changes
- **THEN** the next affected mutation refuses before acting on stale authority
- **AND** no foreign bytes, history or existing locks are removed to force progress

#### Scenario: Object appears at a reviewed absent target
- **WHEN** a directory, database, sidecar or selector appears without this operation's sufficient creation evidence
- **THEN** the next effect refuses rather than adopting, replacing or initializing that object
- **AND** a copied journal or matching path alone is not authority

### Requirement: Durable resumable idempotent steps

Migration and fresh setup SHALL retain private pending/progress records and sufficient intent/completion evidence between requests. Identical current-step retry SHALL reconcile actual durable effects without repeating side effects.

#### Scenario: Journal and resume compatibility
- **WHEN** progress is persisted or resumed
- **THEN** restart/interruption SHALL permit explicit same-target resume with fresh validation and single-writer fencing; changed, reordered or competing requests SHALL not advance stale progress
- **AND** fresh setup SHALL use an explicitly discriminated format-3 journal at the existing location, without fabricated legacy identity or removal evidence
- **AND** format-1 recovery and format-2 migration behavior SHALL remain supported unchanged
- **AND** partial creation that cannot be proven safe SHALL be retained and refused, not repaired or adopted

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

Before confirmation, cancelling inspection SHALL make no product changes. After confirmation, pause/abandonment SHALL stop further steps after the current request settles, retain progress and not imply rollback. Capture on/off/unknown and pending recovery SHALL remain explicit at every step and failure.

#### Scenario: Capture policy across setup
- **WHEN** setup pauses, fails, restarts or reconnects
- **THEN** pause, failure or restart MUST NOT continue work, re-enable capture or restore a global loader automatically
- **AND** new stores SHALL initialize capture off atomically and enable only through their confirmed enable step after prerequisites
- **AND** retained-store reconnection SHALL preserve the current capture setting and contain no enable/disable effect

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

Setup SHALL show actual step progress, pending/paused state, fixed last-action stage/code, capture observation and recovery actions in English, Russian and Simplified Chinese at phone width with accessible focus/announcements. Fresh progress SHALL reflect its frozen plan and creation/reconnection consequences, not the fixed legacy removal-stage count.

#### Scenario: Fresh capability negotiation
- **WHEN** a client negotiates fresh setup
- **THEN** the service SHALL advertise fresh support independently as `managedFreshSteps: 1` in authenticated health and Setup delivery
- **AND** fresh requests SHALL use version 2 on the existing step route; version-1 migration shapes and capability SHALL remain unchanged
- **AND** old single-request migration input and old Windows inspect/configure input SHALL receive a fast non-mutating compatibility refusal
- **AND** new UI SHALL negotiate fresh support rather than fall back to an unsafe long request

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
- **AND** no worker or product write occurs

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

Acceptance SHALL include native Windows released-legacy migration and fresh setup over authenticated HTTP, an independent count of process launches that must be zero, sanitized per-step traces and health checks. Requests SHALL take at most 8 seconds, providing more than twofold margin to the host timeout.

#### Scenario: Evidence fidelity
- **WHEN** acceptance results are recorded
- **THEN** native effect/recovery evidence and browser screenshots SHALL accompany logic checks
- **AND** portable tests SHALL spy on every child-process entry point and prove none is called, but MUST NOT be described as native Windows measurements

#### Scenario: CI verifies the built candidate
- **WHEN** the final built service migrates an isolated released 1.1.1 installation under a non-admin Windows test principal
- **THEN** inspect, step, retry and status paths start no process and meet the time bound with retained identities/history and honest capture state
- **AND** traces contain only bounded stage/code/timing/count/state facts, never account names, paths, credentials or raw logs

#### Scenario: CI verifies empty-store setup
- **WHEN** the built candidate starts with only isolated config/data roots and no legacy, managed directory, store or journal
- **THEN** fresh journeys complete within the request bound with no process started
- **AND** health starts no process and responds within the existing 1.25-second native health bound
- **AND** representative restart, dropped-reply, pause/resume and retained reconnection cases assert actual durable effects
- **AND** over-budget, late-worker and injected-fault cases are covered by portable fixtures only, not by native CI

#### Scenario: Rendered fresh Setup
- **WHEN** current-source guests run the fresh journey in the existing rendered browser harness
- **THEN** screenshots and interaction checks cover review, running creation, paused off/unknown, failure/recovery and completion in EN/RU/zh-CN at phone width
- **AND** keyboard acknowledgement/confirmation, focus return and context retirement remain operable without private fixture data

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

Fresh preparation SHALL reuse existing directory and private-publication owners. Creation and source registration SHALL keep budgeted intent/completion boundaries. New databases SHALL atomically initialize the frozen Store ID and capture-off value without a schema change. Both step families SHALL support explicit same-operation recovery of a proven first journal save. Unproven partial creation SHALL be retained and refused, not adopted, cleaned or repaired.

#### Scenario: Managed directory exists without a valid marker
- **WHEN** a crash leaves the managed directory created but its marker absent or invalid
- **THEN** prepare refuses with a fixed diagnostic and retains the directory
- **AND** its emptiness or private permissions do not authorize adoption

#### Scenario: Marked directory without a journal
- **WHEN** the managed directory and marker are valid and private but no journal was published and no stage remains
- **THEN** fresh same-target validation and confirmation may publish the initial journal
- **AND** this does not authorize adopting an unmarked directory or ambiguous staging

#### Scenario: Reopen after initial publication but before stage removal
- **WHEN** both the published sequence-one journal and its identifiable temporary name survive as the only two links to the same verified private file in the marked directory
- **THEN** Setup can show that operation and its next explicit action after restart, without changing either name or claiming capture from the journal
- **AND** opening Setup, status, inspection and companion loading do not continue setup or grant Store admission from this observation

#### Scenario: Explicit retry finishes the same save
- **WHEN** an exact confirmed begin is retried, or the user explicitly continues the validated pending operation, and the request and pair still match under both writer fences
- **THEN** Setup removes only its verified temporary name and checks the ordinary single-link journal before replaying or processing the requested action
- **AND** finishing the save preserves the published file, bytes and operation identity, and does not itself advance the sequence, repeat a setup effect or change capture
- **AND** subsequent retries use ordinary receipt and sequence rules, including after another interruption following stage removal

#### Scenario: No authority to finish the save
- **WHEN** the family, request, sequence, target, package, object or bytes no longer match, or the necessary fence or work budget is unavailable
- **THEN** the failed precondition does not authorize unlinking, replacement or another effect

#### Scenario: Store creation interrupted
- **WHEN** a store-directory completion or database initialization cannot be proven from the same operation's durable evidence and fresh checks
- **THEN** the partial state is retained with an explicit recovery refusal and no binding/enable effect
- **AND** a completed database initialization may be reconciled only against the frozen Store identity, supported schema and expected pre-registration state, without a writable repair

#### Scenario: Ambiguous publication or sidecars
- **WHEN** interrupted creation leaves a lone or unidentified stage, unrelated or additional links, ambiguous publication files or orphan database sidecars
- **THEN** Setup refuses and retains them for separately authorized diagnosis
- **AND** it does not delete or repair them to make creation succeed; other owned-file hard-link checks remain unchanged

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

### Requirement: Fresh setup is presented as grouped plain-language steps

Fresh setup SHALL present its frozen plan as at most four named groups: create the progress folder, connect it to OpenCode, turn on recording, and check that it works. Each internal step SHALL belong to exactly one group, in frozen order. Grouping SHALL be presentation only: requests, budgets, journal, pause and resume stay per internal step. Migration SHALL keep its own step sequence, reworded only.

#### Scenario: New store
- **WHEN** fresh setup creates a new store and source
- **THEN** four groups are shown, and the current position reads as a step of four

#### Scenario: Retained store or reused source
- **WHEN** the frozen plan omits creation, registration or enabling steps
- **THEN** a group with no step in the plan is not shown, the total counts only shown groups, and the first group's label says an existing folder is used

#### Scenario: Pause inside a group
- **WHEN** setup is paused or closed after one internal step of a group
- **THEN** that group shows as paused, not complete, and explicit resume continues from the next internal step

#### Scenario: Group completion
- **WHEN** every internal step of a group is durably complete
- **THEN** the group is marked complete, and not before

#### Scenario: Failure
- **WHEN** an internal step fails
- **THEN** its group shows the failure with the existing fixed stage and code, and the internal step name is available in the disclosure

### Requirement: Setup review stays explicit while its details fold away

Setup SHALL show one sentence of purpose, the grouped steps and one explicit consent line stating that the progress service runs with the user's account access. Reviewed paths, proposed identities and delivery facts SHALL sit in one disclosure that is operable before confirming. Confirmation SHALL stay bound to the same reviewed facts, and recording state SHALL stay stated at every step.

#### Scenario: Review before starting
- **WHEN** the user reaches the review
- **THEN** the consent control is unchecked by default, the disclosure of what Setup changes can be opened before confirming, and begin is refused until consent is given

#### Scenario: Reviewed facts change
- **WHEN** the reviewed target or facts change before confirmation
- **THEN** begin refuses stale consent exactly as before, whether or not the disclosure was opened

#### Scenario: Recording state while running
- **WHEN** fresh setup is running before its enable step
- **THEN** one plain line says recording is not on yet, without a warning box

#### Scenario: Recording state when stopped
- **WHEN** setup pauses, fails, is closed or completes with recording off or unknown
- **THEN** that state is shown conspicuously with its recovery action

#### Scenario: Three languages at phone width
- **WHEN** review, running, paused, failed and complete states render in English, Russian and Simplified Chinese at phone width
- **THEN** group names, the consent line and recovery actions are readable and operable by keyboard without horizontal overflow
