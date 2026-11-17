## ADDED Requirements

### Requirement: Several plans can be selected on the full page

The full page SHALL offer a Select mode in which plan rows, and plan results while searching, can be selected and deselected one by one by pointer or keyboard. Each row SHALL expose its name and selected state to assistive technology, with no control nested inside another. Select mode MUST NOT exist on the rail or Work Status.

#### Scenario: Select and deselect
- **WHEN** the user enters Select mode and toggles three plan rows
- **THEN** a bar states that three are selected and offers the actions and Clear
- **AND** leaving Select mode or choosing Clear empties the selection

#### Scenario: Keyboard and screen reader
- **WHEN** a keyboard user moves through the rows in Select mode
- **THEN** Space toggles the focused row, its selected state is exposed, and a change in the selected count is announced once per action

#### Scenario: Phone width
- **WHEN** the full page is narrower than 820 CSS pixels, where browsing shows no plan rows
- **THEN** Select shows the plan rows for selection in place of the plan, with a way back, without horizontal overflow and with targets of at least 44 CSS pixels on a coarse pointer

#### Scenario: Rail and Work Status
- **WHEN** the rail or Work Status is shown
- **THEN** neither offers Select mode

### Requirement: A selection belongs to one board reading

The selection SHALL be frame-local and SHALL survive background refreshes. It SHALL be cleared when the account, store, binding, current or archived view, filters or search change. It MUST NOT be stored.

#### Scenario: Refresh keeps the selection
- **WHEN** a background refresh arrives while plans are selected
- **THEN** the selection and the focused row are kept
- **AND** a selected plan that left the reading is no longer counted

#### Scenario: Reading changes
- **WHEN** the user changes a filter, runs or clears a search, or switches between Current and Archived plans
- **THEN** the selection is cleared

#### Scenario: Reload
- **WHEN** the frame is reloaded
- **THEN** nothing is selected

### Requirement: Every matching plan can be selected at once

Select mode SHALL offer Select all, which selects every plan matching the current search and filters, or every plan of the current view when none are set, including plans that are not loaded. The stated count MUST NOT be presented as exact while it may be low.

#### Scenario: Everything, with nothing set
- **WHEN** Select all is chosen with no search or filter
- **THEN** every plan of the current view is selected, including plans inside closed Finished folds and plans not loaded

#### Scenario: Matching a filter or search
- **WHEN** Select all is chosen while a filter or search is set
- **THEN** only the matching plans are selected

#### Scenario: Count before the scan
- **WHEN** some matching plans are not loaded and the action panel has not counted them yet
- **THEN** the selected count carries a plus mark
- **AND** opening an action counts them through a bounded scan and states the number it will act on

#### Scenario: Deselecting after Select all
- **WHEN** the user deselects one loaded row after Select all
- **THEN** that plan is left out of the action and the count drops by one

### Requirement: Selection actions work on plans of any status

With at least one plan selected, the full page SHALL offer Archive and Delete permanently in Current plans, and Restore and Delete permanently in Archived plans, for plans of any status. These actions SHALL follow Tidy's confirmation, run, progress, result and Undo rules.

#### Scenario: Archive a mixed selection
- **WHEN** the user archives 14 selected plans of which three are in progress
- **THEN** after confirming, all 14 are archived and the result offers Undo, which restores the three as in progress

#### Scenario: Delete a selection
- **WHEN** the user chooses Delete permanently for the selected plans
- **THEN** a second step states the count and that it cannot be undone, and only its own button starts deleting

#### Scenario: Restore in Archived plans
- **WHEN** the user selects archived plans, including one that was in progress, and chooses Restore
- **THEN** each is restored with its lifecycle unchanged and the in-progress one accepts reports again

#### Scenario: A selected plan changes before its request
- **WHEN** an agent reports to a selected plan between confirmation and its request
- **THEN** that plan is skipped as changed and reported as not done

### Requirement: In-progress plans in a selection are acknowledged explicitly

When a selection includes in-progress plans, the confirmation's one line SHALL state how many and what follows. Each request for an in-progress plan SHALL carry the in-progress acknowledgement, and no other request SHALL carry it. Without the service capability, in-progress plans SHALL be left out and the line SHALL say how many.

#### Scenario: Archive warning
- **WHEN** three of 14 selected plans are in progress and the user chooses Archive
- **THEN** the confirmation states that three are still in progress and stop updating until restored

#### Scenario: Delete warning
- **WHEN** three of 14 selected plans are in progress and the user chooses Delete permanently
- **THEN** the deletion step states that three are still in progress and that it cannot be undone

#### Scenario: Acknowledgement only where needed
- **WHEN** the run sends its requests
- **THEN** the three requests for in-progress plans carry the acknowledgement and the eleven for closed plans do not

#### Scenario: Service without in-progress cleanup
- **WHEN** the service does not advertise in-progress cleanup and the selection includes three in-progress plans
- **THEN** the confirmation says three in-progress plans are left out, no request is sent for them and the others proceed

### Requirement: An archived in-progress plan can be restored or deleted on its own

In Archived plans, the More menu SHALL offer Restore and Delete permanently for the shown plan whatever its lifecycle. A visible in-progress plan MUST NOT get a per-plan cleanup action; it is acted on through a selection only.

#### Scenario: Restore from More
- **WHEN** an archived in-progress plan is shown in Archived plans
- **THEN** More offers Restore plan and Delete permanently, and Restore returns it to Current plans as in progress

#### Scenario: Visible in-progress plan
- **WHEN** an unarchived in-progress plan is shown on the rail or board
- **THEN** More offers no Archive or Delete action for it
