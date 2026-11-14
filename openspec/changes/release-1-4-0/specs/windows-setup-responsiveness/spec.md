## ADDED Requirements

### Requirement: Cheap honest health and nonblocking admission

Authenticated health SHALL return a cheap last-observed liveness/admission snapshot without security queries or legacy discovery. Starting or unverified state MUST NOT be presented as fresh Store authority. Setup and data access SHALL obtain required fresh admission on demand without synchronous security work blocking the health-serving event loop.

#### Scenario: Cold legacy upgrade
- **WHEN** the service starts with a released legacy installation and no managed selection
- **THEN** health responds without opening/adopting the legacy store or spawning security helpers
- **AND** Setup and background composer access can request admission rather than treating starting as permanently unavailable

#### Scenario: Slow security work is active
- **WHEN** a setup or admission request performs a cold, slow or failing security query
- **THEN** a concurrent authenticated health request remains responsive and honest
- **AND** scheduling main-thread spawnSync through a timer or Promise is not treated as nonblocking

### Requirement: Bounded separate setup requests

Each migration step SHALL be a separate request driven by Setup, with at most six actual security-process spawns including retries, validation, mutation, diagnostics and cleanup. The 2.5-second-per-spawn planning assumption yields 15 seconds of security work plus 5 seconds of headroom under the host's 20-second limit. Inspection/status SHALL be trimmed or continued to meet the same budget, and deadline exhaustion SHALL be explicit rather than weakening checks.

#### Scenario: A phase exceeds the request budget
- **WHEN** inspection, record publication, removal or final status cannot fit after its fresh validation
- **THEN** the work is split at a safe durable boundary or refused without skipping required validation
- **AND** Setup receives bounded progress and explicitly drives the next request rather than one long background migration

#### Scenario: Helper exceeds the planning assumption
- **WHEN** a helper is slower than assumed or fails within the service's below-host deadline
- **THEN** the request stops admitting further work and reports pending, uncertain or failed effects honestly
- **AND** no unbounded cold retry or misleading rollback/success claim occurs

#### Scenario: Supported migration on a slow machine
- **WHEN** the supported legacy fixture is inspected and migrated with helper latency around the 2.5-second-per-spawn assumption
- **THEN** the full switch completes successfully through separate requests below the 20-second host limit and within the six-spawn ceiling
- **AND** repeated bounded refusals are not accepted as successful migration

### Requirement: Fresh authority for every mutation step

Every step SHALL freshly validate its current target, consent/sequence, ownership, privacy, path safety, relevant files and Store/source identity before its mutation. Previous discoveries and durable progress MUST NOT replace current security checks. Full legacy ownership and existing removal safeguards SHALL remain, with no ACL cache across requests or mutations.

#### Scenario: State changes between steps
- **WHEN** an ACL, path object, manifest, source/store, reviewed selection or operation sequence changes
- **THEN** the next affected mutation refuses before acting on stale authority
- **AND** no foreign bytes, history or existing locks are removed to force progress

### Requirement: Durable resumable idempotent steps

Migration SHALL retain private pending/progress records and sufficient intent/completion evidence between requests. Identical current-step retry SHALL reconcile actual durable effects without repeating side effects. Restart/interruption SHALL permit explicit same-target resume with fresh validation and single-writer fencing; changed, reordered or competing requests SHALL not advance stale progress.

#### Scenario: Reply lost after mutation
- **WHEN** the current step committed an effect but its reply was lost
- **THEN** retry returns the reconciled committed state without duplicate removal, binding or capture changes
- **AND** a completed enable replay does not override a later user disable

#### Scenario: Restart or writer interruption
- **WHEN** the service or Setup frame stops between steps or during a mutation boundary
- **THEN** retained progress is shown and explicit resume reconciles the same target safely
- **AND** unknown/foreign locks or unsupported journal formats fail closed rather than being silently deleted or treated as absent

### Requirement: Honest capture and cancellation semantics

Before confirmation, cancelling inspection SHALL make no product changes. After confirmation, pause/abandonment SHALL stop further steps after the current request settles, retain progress and not imply rollback. Capture on/off/unknown and pending recovery SHALL remain explicit at every step and failure. Pause, failure or restart MUST NOT continue migration, re-enable capture or restore a global loader automatically.

#### Scenario: Pause before or after capture disable
- **WHEN** the user pauses or closes Setup
- **THEN** the earlier capture state remains before disable, or off/unknown is visibly retained after disable with a resume action
- **AND** a pending journal alone does not prove capture is off or migration complete

#### Scenario: Successful completion
- **WHEN** all validated transition effects and the authorized enable step have durably completed
- **THEN** Setup reports completion with the verified capture observation
- **AND** matching managed-load observation remains a separate fact

### Requirement: Precise accessible progress and compatibility refusal

Setup SHALL show actual step progress, pending/paused state, fixed last-action stage/code, capture observation and recovery actions in English/Russian at phone width with accessible focus/announcements. Old single-request migration input SHALL receive a fast non-mutating compatibility refusal; new UI SHALL negotiate step support rather than fall back to the unsafe long request.

#### Scenario: Older UI or service
- **WHEN** an older UI sends the old migration input to the new service
- **THEN** the old URL returns HTTP 409 with managed-action-required before migration work, using the existing update-together guidance
- **AND** the new UI sends no step mutation to an older service that lacks the capability

#### Scenario: Failure or retired context
- **WHEN** a step fails or the host/source changes while a response is outstanding
- **THEN** allowlisted diagnostics remain visible without private/raw error content and retired replies cannot resume the driver
- **AND** no invented percentage, completion claim or additional polling loop replaces actual step results

### Requirement: Native Windows responsiveness evidence

Acceptance SHALL include native Windows released-legacy migration over authenticated HTTP, per-request spawn ceilings, sanitized per-step traces and concurrent health checks. Undelayed CI requests SHALL take at most 8 seconds, providing more than twofold margin to the host timeout. Delayed tests SHALL meet the below-host deadline instead. Native effect/recovery evidence and browser screenshots SHALL accompany logic checks.

#### Scenario: CI verifies the built candidate
- **WHEN** the final built service migrates an isolated released 1.1.1 installation under a non-admin Windows test principal
- **THEN** inspect, step, failure, retry and status paths meet the spawn/time bounds with retained identities/history and honest capture state
- **AND** traces contain only bounded stage/code/timing/count/state facts, never account names, paths, credentials or raw logs
