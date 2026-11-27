## MODIFIED Requirements

### Requirement: Map-first plan reading order

The rail and board SHALL present a plan in this order: header with title, progress bar with done/total and a text legend, the Map or List view, Needs you, the sub-agents line, and the incomplete-count indicator when needed. Map SHALL be the default view when complete detail records a task-to-task prerequisite and List otherwise. The view SHALL start with one group: Map and List toggles followed by a localized Plan document button.

#### Scenario: Plan with prerequisites
- **WHEN** a plan whose complete detail records a task-to-task prerequisite is opened on the rail or board
- **THEN** the map opens directly under the title and progress bar, ahead of Needs you and the sub-agents line

#### Scenario: Plan without prerequisites
- **WHEN** complete detail records no task-to-task prerequisite, or the graph capability is unsupported
- **THEN** List opens and the view controls stay available

#### Scenario: Very narrow frame
- **WHEN** a frame is narrower than 320 CSS pixels
- **THEN** List is the default and Map and Plan document remain reachable without horizontal overflow

#### Scenario: Explicit choice
- **WHEN** the user selects Map or List
- **THEN** that choice holds for the reading under the existing reset rules and is not stored

#### Scenario: Open and close the document
- **WHEN** the user activates Plan document by pointer or keyboard
- **THEN** it opens the existing panel in place of the view and focuses the panel heading
- **AND** Back or an unhandled Escape returns to the previous Map or List choice and focuses Plan document
- **AND** the button is not shown when no plan is selected

#### Scenario: Wide board
- **WHEN** the board is at least 820 CSS pixels wide
- **THEN** the plan list is a left column whose rows show each plan's Needs you count, and the selected plan follows the same order on the right

### Requirement: One More menu for secondary content

Each rail and board SHALL have exactly one More menu for applicable copy, History (board), Sessions, archive, user cancellation, hidden-item, Language, Setup, Troubleshooting and deletion of a closed plan. It MUST NOT duplicate Plan document. The rail SHALL also offer its quiet-plan filter there. Language, Setup, Troubleshooting and the rail filter SHALL remain reachable in every state, including no plan, not set up and a failed read. Cancellation MUST NOT be placed in the plan-view controls.

#### Scenario: Panels replace the view
- **WHEN** the user opens History, Sessions, Setup or Troubleshooting from More
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
- **AND** the rail filter remains reachable without authorizing a plan mutation

#### Scenario: Explicit cancellation confirmation
- **WHEN** the person chooses Finish as cancelled for an eligible plan
- **THEN** an inline confirmation identifies that plan and explains retained history and unfinished tasks, intentional reopening, and that running agents are not stopped
- **AND** declining or pressing Escape performs no write and returns focus to More
