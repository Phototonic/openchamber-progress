# closed-plan-tidy Specification

## Purpose
Let a person clean up closed plans in bulk with an explicit confirmation, an honest per-plan result and receipt-bound undo, while every plan keeps its own revision and generation checks.

## Requirements

### Requirement: Explicit confirmation before any request

Opening Tidy SHALL show an inline panel, not a modal, whose one short line states how many plans are in scope and whose buttons name the action and the count. It MUST NOT list plan titles. Cancel SHALL have initial focus, Enter MUST NOT confirm by default and Escape SHALL cancel. No archive, restore or delete request SHALL be sent on opening or cancelling. The deletion step SHALL keep what deletion removes and keeps reachable in one collapsed disclosure.

#### Scenario: Cancel
- **WHEN** the user opens the panel and presses Escape or Cancel
- **THEN** no cleanup request is sent and focus returns to the Tidy button

#### Scenario: Confirm
- **WHEN** the user activates the archive button
- **THEN** each plan in scope is archived through the existing per-plan archive route, bound to the progress revision and cleanup generation captured for it, one request at a time

#### Scenario: Counting plans that are not loaded
- **WHEN** the scope reaches beyond the loaded list
- **THEN** the panel shows that it is counting, sends only reads, and can be cancelled before the count arrives

#### Scenario: More than one run covers
- **WHEN** at least 1,000 matching plans are collected and more remain
- **THEN** the line says it covers the first 1,000 of more, and the rest can be done by using Tidy again

#### Scenario: Scan limit reached first
- **WHEN** the scan reaches its 2,000-plan limit having collected fewer than 1,000 matching plans
- **THEN** the line states the number actually found and that more plans weren't checked, without claiming more matches exist, and offers Check more

#### Scenario: Check more continues past checked plans
- **WHEN** the user chooses Check more after the scan limit
- **THEN** the scan continues from where it stopped in the same reading, reading up to 2,000 further plans and adding their matches to the count, never re-reading plans it already checked
- **AND** a change of store, account, binding, view, search or filters discards the continuation, so the next scan starts from the beginning

#### Scenario: Deletion details
- **WHEN** the user expands the disclosure in the deletion step
- **THEN** it states that stored tasks, history and the document copy are removed, the original file is kept, and deletion is not secure erasure

#### Scenario: Context changes mid-run
- **WHEN** the store, account, binding or board reading changes while requests remain
- **THEN** no further request is sent and the result reports only what completed

### Requirement: Honest result with undo

A run SHALL show a progress line of plans done, and Stop. Its result SHALL be one line counting plans archived or deleted and plans skipped, kept until the next action or refresh, not a timer. After Archive it SHALL offer Undo, restoring each plan it archived through the restore route; a deletion result MUST NOT offer Undo. Archive and Undo MUST NOT change a plan's lifecycle, counts or history. A plan SHALL be reported done only with its validated receipt; none SHALL be retried automatically.

#### Scenario: All archived
- **WHEN** 128 plans are archived
- **THEN** one line says 128 plans were archived and offers Undo, and the plans leave the current list after one authoritative re-read

#### Scenario: Partial failure
- **WHEN** two of 128 plans changed or could not be confirmed
- **THEN** the line says 126 of 128 were archived and two were skipped, with a way to try again for the plans that remain
- **AND** the skipped plans are not retried automatically and are not reported as archived

#### Scenario: Stop
- **WHEN** the user chooses Stop during a run
- **THEN** no further request is sent after the one in flight, and the result states how many were done before stopping

#### Scenario: Undo
- **WHEN** the user chooses Undo
- **THEN** each plan this run archived is restored with its lifecycle unchanged, bound to the cleanup generation its archive returned
- **AND** a plan that changed since is left as it is and reported

#### Scenario: Deleted
- **WHEN** 128 plans are deleted
- **THEN** one line says 128 plans were deleted and no Undo is offered

#### Scenario: Keyboard and announcement
- **WHEN** a run starts and completes
- **THEN** its start and its result are each announced once, individual plans are not announced, and Stop and Undo are reachable by keyboard without moving focus unexpectedly

### Requirement: Tidy is always available on the full page

The full page SHALL show one Tidy button beside search and Filters whenever it shows a plan library and the service supports cleanup. The button MUST NOT be hidden because a search or filter is set or because nothing is eligible. The rail and the More menu on either surface MUST NOT hold a bulk archive entry.

#### Scenario: While searching or filtering
- **WHEN** a search is shown or a project, worktree or session filter is set
- **THEN** the Tidy button is still shown and usable

#### Scenario: Nothing to tidy
- **WHEN** Tidy is opened and no closed plan is in scope
- **THEN** one line says there are no closed plans here, no action is offered and nothing is sent

#### Scenario: Service without cleanup
- **WHEN** the service does not advertise the cleanup capability
- **THEN** the Tidy button is absent, as the other cleanup actions are

#### Scenario: Rail and More
- **WHEN** the rail or the More menu of the rail or board is opened
- **THEN** neither offers a bulk archive entry, and per-plan Archive, Restore and Delete permanently remain for the plan shown

#### Scenario: Phone width and keyboard
- **WHEN** the full page is 390 CSS pixels wide, or operated by keyboard
- **THEN** the Tidy button is reachable in the bar without horizontal overflow, has an accessible name and is at least 44 CSS pixels on a coarse pointer

### Requirement: Tidy covers every closed plan in the board's scope

Tidy SHALL act on closed plans only: finished, cancelled and failed. It MUST NOT act on an in-progress plan. Its scope SHALL be the closed plans matching the current search and filters, or every closed plan of the current view when none are set, including plans that are not loaded. In Current plans it covers unarchived plans; in Archived plans it covers archived ones.

#### Scenario: No search or filter
- **WHEN** Tidy is opened in Current plans with no search or filter and the library holds finished, cancelled, failed and in-progress plans
- **THEN** the panel counts every unarchived finished, cancelled and failed plan and no in-progress plan

#### Scenario: Filtered
- **WHEN** a project filter is set
- **THEN** the panel counts only that project's closed plans and says the count is of matching plans

#### Scenario: Searching
- **WHEN** a search is shown
- **THEN** the panel counts the closed plans among that search's matching plans, including matches not shown yet

#### Scenario: Plans that are not loaded
- **WHEN** older plans were not loaded into the list
- **THEN** opening Tidy reads their identities through a bounded scan before stating the count, and they are included

#### Scenario: A plan reopens before the run
- **WHEN** a plan counted as closed is reopened by its agent before its request is sent
- **THEN** its request is refused as changed, the plan is skipped and it is reported as not done

### Requirement: Tidy archives or deletes permanently

The Tidy panel SHALL offer Archive and Delete permanently for the plans in scope in Current plans, and Delete permanently only in Archived plans. Archive SHALL be undoable. Delete permanently SHALL require its own confirmation step and MUST NOT offer Undo or imply secure erasure.

#### Scenario: Archive
- **WHEN** the user chooses Archive for 128 closed plans
- **THEN** those plans are archived through the per-plan archive route and the result offers Undo

#### Scenario: Delete permanently
- **WHEN** the user chooses Delete permanently
- **THEN** a second step states the count and that it cannot be undone, and only its own button starts deleting

#### Scenario: Archived plans
- **WHEN** Tidy is opened in Archived plans
- **THEN** it offers Delete permanently for the archived closed plans in scope and no Archive action
