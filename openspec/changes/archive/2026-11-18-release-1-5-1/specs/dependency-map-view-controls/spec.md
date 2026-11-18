## MODIFIED Requirements

### Requirement: Opening view fits the plan only when readable

Once per reading, the map SHALL open on the whole plan when its fit-all scale is at least the 70% readability threshold, else at a readable 80% zoom on current work. A coarse pointer SHALL keep its full-size opening zoom. Fit SHALL always show the whole plan. Opening MUST NOT select a task, move focus or repeat on polls. On a fine pointer the rail's map frame SHALL be at least 320 CSS pixels tall and grow with the plan's content at the readable zoom up to 60% of the rail's visible height.

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

#### Scenario: Small plan on the rail
- **WHEN** a plan with one or two rows of tasks is shown on a rail 900 CSS pixels tall with a fine pointer
- **THEN** the map frame is 320 CSS pixels tall

#### Scenario: Larger plan on the rail
- **WHEN** a plan whose content at the readable zoom is between 320 CSS pixels and 60% of the rail's visible height is shown with a fine pointer
- **THEN** the map frame is as tall as that content

#### Scenario: Large plan on the rail
- **WHEN** a plan whose content at the readable zoom is taller than 60% of the rail is shown on a rail 900 CSS pixels tall with a fine pointer
- **THEN** the map frame is 540 CSS pixels tall

#### Scenario: Short rail
- **WHEN** 60% of the rail's visible height is less than 320 CSS pixels
- **THEN** the map frame is 320 CSS pixels tall

#### Scenario: Frame height
- **WHEN** the plan's content is shorter than the frame's maximum on the board, or the pointer is coarse on either surface
- **THEN** the frame shrinks to the content, up to 64% of the viewport height on the board with a fine pointer and up to 300 CSS pixels with a coarse pointer

### Requirement: One help-and-filters control

The map bar SHALL hold the Map | List switch, zoom out, zoom in, Fit, Focus current work and one help-and-filters control. That control SHALL contain the map keys, what the arrows mean, Show all / Unfinished, the group filter and the shown-task count. Its help text SHALL be short: one line of keys, at most two lines on arrows, and one touch line on a coarse pointer. Help, filters and counts MUST NOT appear as separate default rows.

#### Scenario: Filter active
- **WHEN** a task or group filter hides tasks
- **THEN** the control shows a mark, and one line states how many of the plan's tasks are shown with a Clear action

#### Scenario: Help by keyboard
- **WHEN** a keyboard user opens the control
- **THEN** the keys, relationship meanings and filters are reachable in Tab order, and Escape closes it and returns focus to the control

#### Scenario: Help is scannable
- **WHEN** the control is opened in a frame 390 CSS pixels wide in English, Russian or Simplified Chinese
- **THEN** its whole content is visible without a scrollbar of its own
- **AND** it still explains beads, bars, dashes and quiet arrows in words, including that moving beads mean work in progress as reported and not progress made

#### Scenario: Zoom feedback
- **WHEN** the user zooms
- **THEN** the zoom percentage shows briefly and is announced once, without a permanent readout

### Requirement: Navigation is preserved

Dragging, wheel and trackpad panning, pinch zoom, touch taps and every existing map key SHALL keep working. The bar SHALL offer Focus current work, which frames the same current work as the opening view and MUST NOT select a task, move focus or change filters. The pan buttons MAY stay removed because drag and keys cover them. No essential action SHALL depend on a gesture alone.

#### Scenario: Keyboard only
- **WHEN** a keyboard user focuses the map
- **THEN** it is one Tab stop, arrow keys move between cards, bracket keys follow prerequisites and dependents, plus and minus zoom, and the fit key fits the plan

#### Scenario: Touch
- **WHEN** a touch user pans with one finger or pinches with two on a coarse pointer
- **THEN** the map pans or zooms as before, and zoom, Fit and Focus current work remain available as labelled 44 CSS pixel buttons

#### Scenario: Back to current work
- **WHEN** the user has panned away or chosen Fit and then activates Focus current work
- **THEN** the map frames in-progress and Needs you cards with their direct neighbours at the readable zoom, or the whole plan when there is no current work
- **AND** the selection, focus and filters are unchanged and the move is announced once

#### Scenario: Focus current work in three languages
- **WHEN** the map bar is shown in English, Russian or Simplified Chinese at 390 CSS pixels
- **THEN** the button has its translated accessible name and the bar's tools stay on one row
