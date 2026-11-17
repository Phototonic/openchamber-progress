## ADDED Requirements

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
