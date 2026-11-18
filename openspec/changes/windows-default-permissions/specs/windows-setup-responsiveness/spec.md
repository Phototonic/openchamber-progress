## MODIFIED Requirements

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
- **THEN** inspect, step, failure, retry and status paths start no process and meet the time bound with retained identities/history and honest capture state
- **AND** traces contain only bounded stage/code/timing/count/state facts, never account names, paths, credentials or raw logs

#### Scenario: CI verifies empty-store setup
- **WHEN** the built candidate starts with only isolated config/data roots and no legacy, managed directory, store or journal
- **THEN** fresh journeys complete within the request bound with no process started
- **AND** health starts no process and responds within the existing 1.25-second native health bound
- **AND** representative restart, dropped-reply, pause/resume, retained reconnection and over-budget cases assert actual durable effects

#### Scenario: Rendered fresh Setup
- **WHEN** current-source guests run the fresh journey in the existing rendered browser harness
- **THEN** screenshots and interaction checks cover review, running creation, paused off/unknown, failure/recovery and completion in EN/RU/zh-CN at phone width
- **AND** keyboard acknowledgement/confirmation, focus return and context retirement remain operable without private fixture data
