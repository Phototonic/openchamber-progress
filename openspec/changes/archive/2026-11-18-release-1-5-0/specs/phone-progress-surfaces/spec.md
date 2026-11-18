## ADDED Requirements

### Requirement: Simple-by-default surfaces at phone width

At about 390 CSS pixels with a coarse pointer, the rail and board SHALL keep the same order in one column: header, progress, Map or List, Needs you, the sub-agents line and the incomplete-count indicator. The Map | List switch and the map tools SHALL stay on one row. Every new control SHALL be at least 44 CSS pixels and usable without hover or long press.

#### Scenario: Map on a phone
- **WHEN** a plan with prerequisites opens on a phone-width rail
- **THEN** the map is the first content under the progress bar, in a frame no taller than 300 CSS pixels, with zoom, Fit and help-and-filters reachable by tap
- **AND** the page scrolls normally from everything around the map

#### Scenario: Needs you and its actions
- **WHEN** the user expands Needs you and opens an item at phone width in English, Russian or Simplified Chinese
- **THEN** the line, items, scope switch and Open session, Copy reply and Hide are operable by tap with visible focus and no horizontal overflow

#### Scenario: More, Tidy and the indicator
- **WHEN** the user opens More, confirms a bulk archive, uses Undo, or expands and dismisses the indicator at phone width
- **THEN** every step is reachable by tap and keyboard, panels offer a visible Back, and essential actions stay above the keyboard and safe-area insets

#### Scenario: Narrow board
- **WHEN** the board is narrower than 820 CSS pixels
- **THEN** the plan list becomes the header's plan picker and the rest follows the rail order

#### Scenario: Emulation is not device acceptance
- **WHEN** these layouts are verified in an emulated narrow touch browser
- **THEN** the evidence is recorded as emulation, not physical-phone acceptance
