## ADDED Requirements

### Requirement: Opening view fits the plan only when readable

Once per reading, the map SHALL open showing the whole plan when the fit-all scale is at least the readability threshold of 70%. Otherwise it SHALL open at a readable zoom of 80% on current work. A coarse pointer SHALL keep its existing full-size opening zoom. Fit SHALL always show the whole plan. Opening MUST NOT select a task, move focus or repeat on polls.

#### Scenario: Plan fits readably
- **WHEN** the whole plan fits the frame at 70% or more
- **THEN** every card is visible on opening

#### Scenario: Plan too large to fit readably
- **WHEN** the whole plan would need less than 70%
- **THEN** the map opens at the readable zoom on in-progress and Needs you cards with their direct neighbours, or on the first such card in stored order when that group does not fit
- **AND** cards cut by the frame edge remain partly visible and a quiet hint states that Fit shows all tasks with their count

#### Scenario: No current work
- **WHEN** the plan is closed or has no in-progress, Needs you or ready card
- **THEN** the map opens on the whole plan

#### Scenario: Standard rail
- **WHEN** a plan with at least two dependency columns opens in a rail between 360 and 400 CSS pixels wide
- **THEN** it opens on current work at the readable zoom rather than a whole-plan view below the threshold

#### Scenario: Large plans
- **WHEN** the 100-task and 980-task reference plans open on the rail and board
- **THEN** they open on current work within the existing large-plan load and interaction budgets, and Fit still shows the whole plan

#### Scenario: Frame height
- **WHEN** the plan's content is shorter than the frame's maximum
- **THEN** the frame shrinks to the content, up to 300 CSS pixels on the rail and 64% of the viewport height on the board

### Requirement: One help-and-filters control

The map bar SHALL hold the Map | List switch, zoom out, zoom in, Fit and one help-and-filters control. That control SHALL contain the map key, the arrow key, Show all / Unfinished, the group filter and the shown-task count. Help, filters and counts MUST NOT appear as separate default rows.

#### Scenario: Filter active
- **WHEN** a task or group filter hides tasks
- **THEN** the control shows a mark, and one line states how many of the plan's tasks are shown with a Clear action

#### Scenario: Help by keyboard
- **WHEN** a keyboard user opens the control
- **THEN** the keys, relationship meanings and filters are reachable in Tab order, and Escape closes it and returns focus to the control

#### Scenario: Zoom feedback
- **WHEN** the user zooms
- **THEN** the zoom percentage shows briefly and is announced once, without a permanent readout

### Requirement: Navigation is preserved

Dragging, wheel and trackpad panning, pinch zoom, touch taps and every existing map key SHALL keep working. The pan buttons and the focus-current-work button MAY be removed because drag, keys and the opening view cover them. No essential action SHALL depend on a gesture alone.

#### Scenario: Keyboard only
- **WHEN** a keyboard user focuses the map
- **THEN** it is one Tab stop, arrow keys move between cards, bracket keys follow prerequisites and dependents, plus and minus zoom, and the fit key fits the plan

#### Scenario: Touch
- **WHEN** a touch user pans with one finger or pinches with two on a coarse pointer
- **THEN** the map pans or zooms as before, and zoom and Fit remain available as labelled 44 CSS pixel buttons

### Requirement: Compact card and selected-task summary

A card SHALL show its state in plain words, the literal title on up to two lines, and the running sub-agent's name when proven. A blocked task that is a Needs you item SHALL read as needing the user; any other blocked task SHALL read as blocked. Selecting a card SHALL open a compact summary with state, what it waits on, what it unlocks, its reported blocker text and a verified Open session for its running sub-agent.

#### Scenario: Needs you card
- **WHEN** a task is blocked with a decision the top-level main session reported
- **THEN** its card and accessible name say it needs the user

#### Scenario: Sub-agent blocker card
- **WHEN** a task is blocked with a decision that a sub-agent reported
- **THEN** its card says blocked, and its summary still shows the reported reason and next action

#### Scenario: Region and card names
- **WHEN** a screen reader reaches the map
- **THEN** the region name states the plan title, task count and counts by state, and each card name states title, state, what it waits on and how many tasks it unlocks
