# atomic-plan-finish Specification

## Purpose
Let coordinators finish a plan and report its final task changes atomically, preserving authority, revision, validation and replay guarantees.

## Requirements

### Requirement: Optional atomic final task changes

Coordinator finish SHALL optionally accept the same 1–50 unique explicit task changes and validation limits as change. Changes and finish SHALL commit atomically at the expected revision. Successful finished outcome SHALL still require nonzero actionable work with none remaining after the changes. Omitted changes SHALL retain existing finish behavior.

#### Scenario: Finish with last task changes
- **WHEN** the coordinator supplies valid changes resolving the remaining actionable work and outcome finished
- **THEN** one ordinary revision records the explicit task changes, direct contribution and closed lifecycle
- **AND** structural revision does not advance

#### Scenario: Any component refuses
- **WHEN** a task is a group/unknown, validation or authority fails, the revision conflicts, actionable work remains, or commit fails
- **THEN** neither task changes nor finish is newly committed
- **AND** the existing useful validation/conflict guidance remains, including the group/unknown-ID hint

#### Scenario: Cancelled or failed outcome
- **WHEN** the coordinator supplies valid explicit changes with cancelled or failed
- **THEN** changes and the requested outcome commit together under existing close/blocker-history rules
- **AND** no implicit done status is assigned to other tasks

### Requirement: Full-input replay and old writer behavior

Finish replay SHALL bind complete semantic input and actual caller identity. Identical accepted retries SHALL return the original receipt without another revision; altered operation reuse SHALL refuse. Children SHALL remain unable to finish. Older writers SHALL remain usable for existing operations and MUST NOT falsely accept unsupported combined input.

#### Scenario: Identical or altered retry
- **WHEN** an accepted combined finish is retried identically or with changed/omitted changes under the same operation ID
- **THEN** the identical retry returns its prior result and altered reuse refuses without new writes

#### Scenario: Older or restricted caller
- **WHEN** an older report tool receives the new optional field or an assigned child attempts finish
- **THEN** unsupported input or authority is refused rather than field-stripped into another operation

### Requirement: Confirmed user cancellation has narrow authority

A capable service SHALL accept an explicit confirmed single-plan user cancellation through its authenticated host proxy. It SHALL require current verified store/source binding, enabled recording, visible active lifecycle and matching progress/cleanup revisions. It MUST NOT accept supplied actor identity, task changes or another outcome, impersonate a session, or widen agent reporting authority.

#### Scenario: Authorized user action
- **WHEN** a confirmed request names an eligible plan at the reviewed identity and revisions
- **THEN** the service records one cancelled lifecycle revision attributed to user
- **AND** the coordinator remains the plan owner

#### Scenario: Admission refusal
- **WHEN** authentication, binding/source verification, recording state, confirmation or input validation fails
- **THEN** cancellation is refused with a fixed error and no new plan, actor or receipt is stored

#### Scenario: Concurrent change or cleanup
- **WHEN** a report, reopen, archive, restore or deletion invalidates the reviewed target before cancellation commits
- **THEN** the request refuses rather than rebasing or acting on another state

### Requirement: User cancellation preserves work and audit

Cancellation SHALL atomically retain unfinished task statuses and prior history while recording a distinct service-authored user actor, one ordinary revision and an idempotent receipt. Structural revision, ownership and document capture SHALL remain unchanged. Existing close rules for current blocker metadata SHALL apply. History SHALL expose fixed user attribution without inventing a named human or agent contribution.

#### Scenario: Unfinished work and documents
- **WHEN** a plan with pending, working, blocked, done and skipped tasks and a captured document is cancelled
- **THEN** task IDs, statuses, counts and captured bytes remain, earlier blocker history remains, and only closure-invalid current metadata is cleared
- **AND** no source document is read or changed

#### Scenario: Receipt replay and reuse
- **WHEN** the same admitted user request is replayed, or its operation ID is reused with different semantic input or an agent operation
- **THEN** the identical replay returns its original receipt without another revision, while changed or cross-authority reuse refuses
- **AND** replay after reopening does not cancel the plan again

#### Scenario: Transaction failure
- **WHEN** storage fails before commit
- **THEN** neither a partial closure, audit row nor receipt survives

#### Scenario: Read history
- **WHEN** the cancellation revision is read in History
- **THEN** it is labelled Cancelled by user, without a coordinator-report attribution
- **AND** later reopening does not erase that row

### Requirement: Reopen and mixed-version safety remain explicit

User-cancelled plans SHALL reopen only through the existing authorized coordinator revise/commit path with explicit reopen intent. Ordinary late reports and dispatch binding SHALL not reopen them. Guests SHALL negotiate the new cancellation capability and retire stale confirmations and replies. Older services SHALL receive no unsupported cancellation request.

#### Scenario: Intentional continuation
- **WHEN** the coordinator submits a current-revision title-only revise with reopen true, or valid reopen staging followed by commit
- **THEN** the plan becomes active under existing rules, retaining unfinished statuses where no replacement overrides them
- **AND** staging alone leaves it closed

#### Scenario: Late report or dispatch
- **WHEN** ordinary progress or an earlier pending dispatch attempts to mutate the cancelled plan
- **THEN** existing closed/revision/assignment fences refuse and no automatic reopening occurs

#### Scenario: Retired confirmation
- **WHEN** selection, scope, account, store/binding, revisions, visibility or capability changes before confirmation
- **THEN** the old confirmation cannot authorize a new request
- **AND** a dispatched request's late reply cannot acknowledge success in a different reading

#### Scenario: Older service and rollback
- **WHEN** a newer guest uses an older service, or the service is rolled back after cancellation
- **THEN** unsupported cancellation controls send no request, stored plans remain readable, and existing explicit reopen semantics still work
- **AND** rollback preserves cancelled state and user audit without data conversion
