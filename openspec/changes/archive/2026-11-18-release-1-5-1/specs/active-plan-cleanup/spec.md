## ADDED Requirements

### Requirement: An in-progress plan is archived or deleted only with an explicit acknowledgement

The archive and delete routes SHALL accept an in-progress plan only when the request carries the literal in-progress acknowledgement beside its existing fields. Without it, an in-progress plan SHALL be refused with the existing `closed` conflict, exactly as before. A request that carries it for a plan that is not in progress SHALL be refused with `closed`. Delete SHALL still require its own literal confirmation.

#### Scenario: Archive with the acknowledgement
- **WHEN** an archive request with the acknowledgement names an in-progress plan at its current progress revision and cleanup generation
- **THEN** the plan becomes archived, its cleanup generation advances by one and a receipt is returned
- **AND** its lifecycle, tasks, counts, progress revision and history are unchanged

#### Scenario: Archive or delete without the acknowledgement
- **WHEN** a request without the acknowledgement names an in-progress plan
- **THEN** it is refused with `closed` and nothing changes

#### Scenario: Delete an in-progress plan
- **WHEN** a delete request carries both the confirmation and the acknowledgement for an in-progress plan
- **THEN** the plan's stored content is removed as for a closed plan and a receipt with the deleted state is returned
- **AND** the same request without the confirmation is refused as invalid

#### Scenario: Acknowledgement on a closed plan
- **WHEN** a request carries the acknowledgement for a finished, cancelled or failed plan
- **THEN** it is refused with `closed` and nothing changes

### Requirement: Restore accepts an archived plan of any lifecycle

Restore SHALL accept an archived plan whatever its lifecycle, SHALL leave that lifecycle unchanged and SHALL refuse a request that carries the acknowledgement field.

#### Scenario: Restore an archived in-progress plan
- **WHEN** a restore request names an archived plan whose lifecycle is in progress
- **THEN** the plan becomes visible and in progress again with its cleanup generation advanced by one

#### Scenario: Restore with the acknowledgement
- **WHEN** a restore request carries the acknowledgement field
- **THEN** it is refused as invalid and nothing changes

### Requirement: Revision checks and receipts are unchanged

Every cleanup request SHALL stay bound to the store, source, plan, progress revision and cleanup generation it names, and a stale value SHALL be refused with `conflict` without changing anything. Only the latest identical request SHALL replay its receipt. The acknowledgement SHALL be part of the request's identity for replay. Receipt shape, error codes and statuses MUST NOT change, and no request SHALL name more than one plan.

#### Scenario: The plan was reported to after confirmation
- **WHEN** an agent's report advances the plan's revision between confirmation and the request
- **THEN** the request is refused with `conflict` and the plan is neither archived nor deleted

#### Scenario: The plan finished after confirmation
- **WHEN** a plan confirmed as in progress is finished before the request arrives
- **THEN** the request is refused with `conflict` because its revision is stale

#### Scenario: Replay
- **WHEN** the latest request is sent again unchanged
- **THEN** its original receipt is returned and the cleanup generation does not advance again

#### Scenario: Reused operation with a different acknowledgement
- **WHEN** the latest operation identifier is reused with the acknowledgement added or removed
- **THEN** the request is refused with `operation-reused`

### Requirement: The capability is advertised separately

A ready service that accepts the acknowledgement SHALL advertise it in health as its own additive fact, and the existing cleanup capability SHALL keep its value and meaning. A guest SHALL send the acknowledgement only when the fact is advertised.

#### Scenario: Earlier guest
- **WHEN** a guest from the previous release uses the newer service
- **THEN** its archive, restore and delete requests behave as before and an in-progress plan is still refused

#### Scenario: Earlier service
- **WHEN** a newer guest uses a service that does not advertise the fact
- **THEN** it sends no acknowledgement, leaves in-progress plans out of the action and says how many it left out

### Requirement: Reports to an archived plan are refused until it is restored

While a plan of any lifecycle is archived, every report operation on it SHALL be refused with `closed` before receipt replay and SHALL store nothing. Reading it SHALL still work. The service MUST NOT restore a plan because a report arrived. After the plan is restored, reports SHALL be accepted again at its unchanged revision.

#### Scenario: Agent reports progress to an archived in-progress plan
- **WHEN** the plan's main session reports a task change after the plan was archived
- **THEN** the report is refused with `closed`, the plan's revision, tasks and history are unchanged and the plan stays archived

#### Scenario: Reopen is refused
- **WHEN** the main session sends a revision with reopen to an archived plan
- **THEN** it is refused with `closed`

#### Scenario: Retried earlier report
- **WHEN** a report that was acknowledged before the archive is sent again
- **THEN** it is refused with `closed` and its earlier receipt is not replayed

#### Scenario: Sub-agent handoff or delegation
- **WHEN** a sub-agent hands off, or the main session declares or links a delegation, for an archived plan
- **THEN** the operation is refused with `closed` and no task is assigned or changed

#### Scenario: Restored
- **WHEN** the person restores the plan and the agent reports at the plan's current revision
- **THEN** the report is accepted and the revision advances by one

### Requirement: Reports to a deleted plan are refused and its identifier is never reused

After a plan of any lifecycle is deleted, every report operation naming it SHALL be refused with `not-found`, including a start with the same identifier. Deleting an in-progress plan SHALL remove the same stored content as deleting a closed plan, including staged uploads, and SHALL keep the tombstone. Deletion MUST NOT be presented as secure erasure.

#### Scenario: Agent reports to a deleted plan
- **WHEN** the main session reports a change to a plan the person deleted
- **THEN** the report is refused with `not-found` and nothing is stored

#### Scenario: Starting again under the same identifier
- **WHEN** an agent starts a plan with the deleted plan's identifier
- **THEN** the start is refused with `not-found`
- **AND** a start with a new identifier creates an independent plan

#### Scenario: Staged structure in flight
- **WHEN** an in-progress plan with staged but uncommitted structure is deleted
- **THEN** the staged chunks are removed and a later commit of that upload is refused with `not-found`

### Requirement: An archived or deleted in-progress plan stops supplying current work

An archived or deleted in-progress plan SHALL leave ordinary plan lists, featured-plan choices, Needs you, resume briefs and waiting-delegation views under the rules that already apply to archived and deleted plans. A delegation declared before the action MUST NOT bind afterwards. Recorded sub-agent runs SHALL remain.

#### Scenario: Needs you
- **WHEN** an in-progress plan with a decision blocker reported by its top-level main session is archived
- **THEN** the item leaves Needs you and its counts on the next read
- **AND** restoring the plan brings the item back

#### Scenario: Rail and Work Status
- **WHEN** the only plan of a session is archived while in progress
- **THEN** the rail and Work Status for that session show no plan, not the archived one

#### Scenario: Pending delegation
- **WHEN** a sub-agent is dispatched after its plan was archived or deleted with a delegation still waiting
- **THEN** no task is assigned or changed and the existing delegation refusal applies

### Requirement: Older writers and services stay safe

The persistent store guards SHALL fence writes to an archived or deleted plan whatever its lifecycle, including from writers loaded before the action and from older releases. The cleanup storage format MUST NOT change.

#### Scenario: Older writer
- **WHEN** a writer from an earlier release attempts a report to an archived in-progress plan
- **THEN** the write is aborted and nothing is stored

#### Scenario: Older service after a rollback
- **WHEN** the previous release's service runs on a store that holds an archived in-progress plan
- **THEN** the plan stays readable and archived, a restore is refused with `closed`, and no data is lost
