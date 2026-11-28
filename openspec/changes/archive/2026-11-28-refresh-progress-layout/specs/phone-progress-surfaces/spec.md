## MODIFIED Requirements

### Requirement: Simple-by-default surfaces at phone width

At about 390 CSS pixels, board and rail SHALL remain one column. Board controls reflow above its plan picker; the rail retains the switcher and session-scoped Needs you after Map/List. Both SHALL keep one four-view group, plan actions, sub-agents and incomplete-count indicator reachable. The view group and map tools MAY occupy separate rows. New coarse-pointer targets SHALL be at least 44 CSS pixels and require no hover or long press.

#### Scenario: Map on a phone
- **WHEN** a plan with prerequisites opens on a phone-width rail
- **THEN** Map is the first reading under the header, progress and view controls, with its frame no taller than 300 CSS pixels and zoom, Fit and help reachable by tap
- **AND** the page scrolls normally outside the map

#### Scenario: Needs you and its actions
- **WHEN** the reader opens the board count or the rail disclosure in English, Russian or Simplified Chinese
- **THEN** items, scope choice and applicable Open session, Copy reply and Hide actions are operable by tap and keyboard with visible focus and no whole-page horizontal overflow

#### Scenario: More, Tidy and the indicator
- **WHEN** the reader uses Settings, More, Tidy, Undo or the incomplete-count indicator
- **THEN** essential controls remain reachable around the keyboard and insets; panels retain Back and appropriate focus return

#### Scenario: Narrow board
- **WHEN** the board falls below the existing 820 CSS pixel browse breakpoint
- **THEN** browse rows give way to the plan picker, while search, Hide quiet, Filters, count, Settings, Select and Tidy remain reachable when applicable

#### Scenario: Emulation is not device acceptance
- **WHEN** these layouts are verified in an emulated narrow touch browser
- **THEN** the evidence is recorded as emulation, not physical-device acceptance
