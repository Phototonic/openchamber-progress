## ADDED Requirements

### Requirement: Bulk archive covers finished and cancelled plans only

The More menu SHALL offer one action that archives the finished and cancelled plans the surface lists: the selected session's on the rail and the current list's on the board. Failed and active plans MUST NOT be included. The action's label and confirmation SHALL name what is covered and MUST NOT describe the set as all closed plans. No bulk action SHALL delete a plan.

#### Scenario: Mixed closed plans
- **WHEN** the surface lists two finished, one cancelled and one failed plan
- **THEN** the action covers the three finished and cancelled plans and one line says failed plans are kept
- **AND** the failed plan stays listed and can still be archived on its own

#### Scenario: Nothing eligible
- **WHEN** no finished or cancelled plan is listed, or the service lacks the cleanup capability
- **THEN** the action is absent

#### Scenario: More eligible than one run covers
- **WHEN** more plans are eligible than the per-confirmation limit
- **THEN** the confirmation states how many of the total it covers, and the rest can be archived by repeating the action

### Requirement: Explicit confirmation before any request

Choosing the action SHALL open an inline confirmation, not a modal, that names the count and lists each plan with its outcome. Cancel SHALL have initial focus, Enter MUST NOT archive by default and Escape SHALL cancel. Nothing SHALL be sent on opening or cancelling.

#### Scenario: Cancel
- **WHEN** the user opens the confirmation and presses Escape or Cancel
- **THEN** no request is sent and focus returns to the More button

#### Scenario: Confirm
- **WHEN** the user activates the archive button
- **THEN** each listed plan is archived through the existing per-plan archive route, bound to the revision and cleanup generation captured at confirmation, one request at a time

#### Scenario: Context changes mid-run
- **WHEN** the store, account, binding or surface scope changes while requests remain
- **THEN** no further request is sent and the result reports only what completed

### Requirement: Honest result with undo

The result SHALL be one line stating how many plans were archived, with Undo. It SHALL stay until the next action or refresh, not a timer. Undo SHALL restore each plan this action archived through the existing restore route. Archive and Undo MUST NOT change a plan's lifecycle, counts or history.

#### Scenario: All archived
- **WHEN** four plans are archived
- **THEN** one line says four plans were archived and offers Undo, and the plans leave the current list after one authoritative re-read

#### Scenario: Partial failure
- **WHEN** one of four plans changed or could not be archived
- **THEN** the line says three of four were archived and one could not be, with a retry
- **AND** the unarchived plan is not retried automatically and is not reported as archived

#### Scenario: Undo
- **WHEN** the user chooses Undo
- **THEN** each plan this action archived is restored with its lifecycle unchanged, bound to the cleanup generation its archive returned
- **AND** a plan that changed since is left as it is and reported

#### Scenario: Keyboard and announcement
- **WHEN** the action completes
- **THEN** the result is announced once and Undo is reachable by keyboard without moving focus unexpectedly
