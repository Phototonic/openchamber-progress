## ADDED Requirements

### Requirement: Map-first plan reading order

The rail and board SHALL present a plan in this order: header with title, progress bar with done/total and a text legend, the Map or List view, Needs you, the sub-agents line, and the incomplete-count indicator when needed. Map SHALL be the default view whenever complete detail records a task-to-task prerequisite and List otherwise. One Map | List switch SHALL sit at the top of that view.

#### Scenario: Plan with prerequisites
- **WHEN** a plan whose complete detail records a task-to-task prerequisite is opened on the rail or board
- **THEN** the map opens directly under the title and progress bar, ahead of Needs you and the sub-agents line

#### Scenario: Plan without prerequisites
- **WHEN** complete detail records no task-to-task prerequisite, or the graph capability is unsupported
- **THEN** List opens and the Map | List switch stays available

#### Scenario: Very narrow frame
- **WHEN** a frame is narrower than 320 CSS pixels
- **THEN** List is the default and Map remains selectable

#### Scenario: Explicit choice
- **WHEN** the user selects Map or List
- **THEN** that choice holds for the reading under the existing reset rules and is not stored

#### Scenario: Wide board
- **WHEN** the board is at least 820 CSS pixels wide
- **THEN** the plan list is a left column whose rows show each plan's Needs you count, and the selected plan follows the same order on the right

### Requirement: One More menu for secondary content

Each rail and board SHALL have exactly one More menu holding copy actions, Plan document, History (board), Sessions, archive actions, hidden items, Language, Setup, Troubleshooting and deletion of a closed plan. Only applicable entries SHALL appear. Language, Setup and Troubleshooting SHALL be reachable in every state, including no plan, not set up and a failed read.

#### Scenario: Panels replace the view
- **WHEN** the user opens Plan document, History, Sessions, Setup or Troubleshooting from More
- **THEN** it opens as a panel in place of the map or list, and Back returns to the view with focus on the More button

#### Scenario: Menu keyboard use
- **WHEN** the menu is operated with a keyboard or a coarse pointer
- **THEN** it follows menu semantics with arrow keys and type-ahead, Escape returns focus to its button, and rows are at least 44 CSS pixels high on a coarse pointer

#### Scenario: New history
- **WHEN** this device's saved review point for the selected plan is older than the plan's current revision
- **THEN** the board's More button shows a dot with an accessible name, without an additional history read
- **AND** no dot appears without a saved review point or without device storage

#### Scenario: Before setup or after a failed read
- **WHEN** the extension is not set up, no plan is shown, or the progress read failed
- **THEN** More still offers Language, Setup and Troubleshooting

### Requirement: Advanced controls leave the default UI without losing facts

The default UI MUST NOT show the Details disclosure, the reporting-health panel, footer disclosures, task view options, the participant filter, the order toggle, expand/collapse all, per-task copy, the map's own heading and count line, or scope and coverage sentences. Every diagnostic fact they showed SHALL remain reachable under Troubleshooting → Advanced details. No service data or route SHALL be removed.

#### Scenario: Advanced details
- **WHEN** the user opens Troubleshooting and expands Advanced details
- **THEN** the plan and store identifiers, recording state, document state, live-session count, report authorship and health observations that Details and Reporting health showed are present

#### Scenario: Support summary
- **WHEN** the user copies the support summary
- **THEN** every line it contained before this change is present with the same text, order and values
- **AND** appended lines state the active incomplete-count reasons and this build's limits using fixed vocabulary, with no plan text, identifiers or paths

#### Scenario: Troubleshooting panel
- **WHEN** Troubleshooting opens
- **THEN** it shows one sentence, Copy support summary, Check again and collapsed Advanced details

#### Scenario: Unfinished filter
- **WHEN** the user wants only unfinished tasks
- **THEN** Show all / Unfinished is available in the help-and-filters control for both Map and List

### Requirement: Compact Work Status

Work Status SHALL show at most five lines: the featured plan's title with a position picker, the progress bar with done/total, one activity line, one qualification line and Open progress. It MUST NOT show state chips, focus rows, a current-task line, sub-agent rows or a separate more-plans line, and SHALL stay within the host's maximum section height.

#### Scenario: Active plan
- **WHEN** the featured plan is active with two running sub-agents and one Needs you item in the selected session's plans
- **THEN** the activity line states two running and one needing the user, each part only when nonzero

#### Scenario: Sub-agent waiting for the user
- **WHEN** the host shows a sub-agent session waiting on a question or permission
- **THEN** the activity line states it as a sub-agent waiting for the user, apart from the Needs you count

#### Scenario: Stale only when stale
- **WHEN** an active plan's last report is more than one hour old
- **THEN** the qualification line states the age of the last update
- **AND** a fresher plan shows no time, and a failed read shows its own undismissable line with a retry

#### Scenario: Recording off or plan closed
- **WHEN** recording is off, or the featured plan is finished, cancelled or failed
- **THEN** the qualification line says recording is off, or the activity line states the plan's outcome in words

#### Scenario: Possibly incomplete counts
- **WHEN** a sub-agent or Needs you count may be low
- **THEN** the number carries a plus mark and no indicator line is added

#### Scenario: Narrow and translated
- **WHEN** the card is 190 CSS pixels wide in English, Russian or Simplified Chinese
- **THEN** it wraps without horizontal overflow and its content height does not exceed the host's 480 pixel section maximum

#### Scenario: Open from the count
- **WHEN** the user selects the Needs you count or Open progress
- **THEN** the rail opens with no task payload and no host-session change, and the rail's Needs you shows in its saved state
