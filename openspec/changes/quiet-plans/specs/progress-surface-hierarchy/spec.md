## MODIFIED Requirements

### Requirement: One More menu for secondary content

Each rail and board SHALL have exactly one More menu for applicable copy, Plan document, History (board), Sessions, archive, user cancellation, hidden-item, Language, Setup, Troubleshooting and deletion of a closed plan. The rail SHALL also offer its quiet-plan filter there. Language, Setup, Troubleshooting and the rail filter SHALL remain reachable in every state, including no plan, not set up and a failed read. Cancellation MUST NOT be placed in the plan-view switch.

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
- **AND** the rail filter remains reachable without authorizing a plan mutation

#### Scenario: Explicit cancellation confirmation
- **WHEN** the person chooses Finish as cancelled for an eligible plan
- **THEN** an inline confirmation identifies that plan and explains retained history and unfinished tasks, intentional reopening, and that running agents are not stopped
- **AND** declining or pressing Escape performs no write and returns focus to More

## ADDED Requirements

### Requirement: Quiet is a factual stored-report age

Rail and board SHALL label active plans whose valid stored report timestamp is at least seven elapsed days old as “No reports for N days,” using whole elapsed days and localized copy. The label MUST NOT infer completion, failure, abandonment or live inactivity. Invalid or future timestamps SHALL produce no quiet classification. No extra service read SHALL be required.

#### Scenario: Threshold and clock
- **WHEN** an active plan's report is just below seven days old, exactly seven days old, or nine whole days old by browser wall time
- **THEN** it has respectively no quiet label, a seven-day label, or a nine-day label
- **AND** no live-session observation changes that result

#### Scenario: Report resumes
- **WHEN** a newer stored report is observed below the threshold
- **THEN** its quiet label and age-based exclusion disappear on the refreshed view

#### Scenario: Unknown time or closed work
- **WHEN** report time is invalid/future or the plan is closed
- **THEN** no quiet label is shown and the quiet predicate does not exclude it

### Requirement: Quiet filtering changes presentation only

A remembered filter SHALL exclude quiet plans from rail and board pickers, browse rows and board search results while retaining original ordering and whole-plan counts. It SHALL start enabled, remain reversible without a selected plan, and never mutate reports, narrow Needs you or change Work Status selection/visibility. Partial reads SHALL remain qualified; a filtered empty view MUST NOT claim that no plans were reported.

#### Scenario: Hidden selected plan
- **WHEN** the selected plan is excluded
- **THEN** the existing first eligible fallback is shown, or a filter-specific empty state offers Show all plans
- **AND** filtering alone does not overwrite the saved rail selection or change lifecycle

#### Scenario: Bounded board search
- **WHEN** a search runs with the filter on
- **THEN** the same local age predicate applies before emitted hits and match counts, using one cutoff per traversal
- **AND** existing bounds, continuation and as-searched qualifications remain; refresh observes newer reports

#### Scenario: Changed search preference
- **WHEN** the remembered preference changes during a search reading
- **THEN** that reading is retired and Refresh search is offered
- **AND** saving or reading device preferences does not itself start another search

#### Scenario: Bulk action scope
- **WHEN** Select all or a cleanup count scans the filtered scope
- **THEN** excluded quiet plans are not silently counted or targeted
- **AND** a changed filter retires a confirmation bound to the previous scope

#### Scenario: No new observation loop
- **WHEN** the threshold is crossed during an unchanged visible refresh
- **THEN** classification is reevaluated on the existing refresh path without another timer, report write or additional list/detail query

#### Scenario: Accessible translated views
- **WHEN** the rail or board is used in English, Russian or Simplified Chinese
- **THEN** labels, filter state, confirmation, errors and historical user attribution use that language and remain keyboard and narrow-screen usable
