## MODIFIED Requirements

### Requirement: One help-and-filters control

In Map, zoom out/in, Fit, Focus current work and one help-and-filters control SHALL sit to the right of the shared view switch on the wide board. The tools MAY follow on a separate row at narrow widths. Help SHALL contain keys, arrow meanings, Show all / Unfinished, group filter and shown-task count. There SHALL be no duplicate switch or permanent help/count row.

#### Scenario: Filter active
- **WHEN** a task or group filter hides tasks
- **THEN** the control shows its active mark, and one line states how many tasks are shown with a Clear action

#### Scenario: Help by keyboard
- **WHEN** the reader opens help with the keyboard
- **THEN** keys, relationships and filters are reachable in Tab order, and Escape closes help and returns focus to its control

#### Scenario: Help is scannable
- **WHEN** the map is shown at 390 CSS pixels in English, Russian or Simplified Chinese
- **THEN** its tools remain usable together without squeezing the view labels, and opened help fits without an internal scrollbar
- **AND** the explanation distinguishes reported work in progress from progress made, and explains beads, bars, dashes and quiet arrows
- **AND** keys take one line, arrows at most two, and a coarse pointer gets one touch line

#### Scenario: Zoom feedback
- **WHEN** the reader changes the map zoom
- **THEN** its percentage appears briefly and is announced once, not as a permanent readout
