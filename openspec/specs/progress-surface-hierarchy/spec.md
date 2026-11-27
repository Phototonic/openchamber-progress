# progress-surface-hierarchy Specification

## Purpose
Give the rail and board one reading order, with the map first, one More menu for secondary content, advanced facts moved out of the default view and a compact Work Status.

## Requirements

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

### Requirement: Read the selected plan's activity inside List

The rail and board SHALL offer a collapsed, keyboard-operable Activity section inside the selected plan's List. On demand it SHALL show one row per recorded revision with its number, time, who reported it and the task IDs recorded for that revision. All interface text SHALL be available in English, Russian and Simplified Chinese. The section MUST NOT change progress, read transcripts or document content, change the plan-view switch, or mark History reviewed.

#### Scenario: Two sub-agents and a coordinator
- **WHEN** a coordinator reports directly, one assigned child reports its own tasks, and the coordinator relays an update attributed to a second child
- **THEN** each row matches that revision's stored time and item IDs, including multiple IDs in one report, and distinguishes the coordinator from the reporting sub-agent
- **AND** direct and relay rows use the same localized wording and session labels as the task rail, with both reporter and credited child on the relay
- **AND** later reports for the same tasks neither merge earlier rows nor change task counts

#### Scenario: Reports without item details
- **WHEN** a report names no task IDs, names an ID since removed, or a revision has no available report details
- **THEN** the first row indicates that no task IDs were reported, the second retains its recorded ID, and the last qualifies the missing information without inventing a reporter or changes

#### Scenario: A user cancellation followed by reopening
- **WHEN** the user cancels a plan and the coordinator later reopens it
- **THEN** the cancellation revision remains in place with its stored time and History's localized “Cancelled by user”, with no named human, coordinator contribution or changed tasks
- **AND** an agent-reported cancelled outcome is not labelled as a user cancellation

### Requirement: Page activity without loading the history first

Activity SHALL read and render only a bounded page at a time, starting with the newest revisions through the selected reading. It SHALL permit navigation back to the first revision, keep List usable during a read, and never require complete task detail. Routine refreshes and other surfaces MUST NOT fetch activity pages.

#### Scenario: Large retained history
- **WHEN** a plan has more than 250 revisions
- **THEN** the closed section makes no activity request; opening it reads one page, and each requested older page replaces the visible page without scanning the full history
- **AND** the reader can return to a newer page or reach revision one without gaps, duplicates, or pulling in a report appended during the visit

#### Scenario: A reply arrives after leaving a plan
- **WHEN** a page read is pending and the user closes the section or switches readings, including to a same-ID plan from another source
- **THEN** the controls outside the section still work and the late reply cannot populate or reopen the retired section

#### Scenario: Read unavailable
- **WHEN** a page is unsupported, unreadable or inconsistent with its requested window
- **THEN** the section reports unavailability rather than empty or complete history, with no inferred report or fallback content access
- **AND** the existing task list and board History remain independently usable

### Requirement: Read-only Markdown in the Plan document panel

The sidebar and Pages → Agent Progress SHALL present the same formatted preview when readable captured text is identified by a saved document reference with a `.md` suffix, matched case-insensitively. Documents with other suffixes or no path SHALL remain literal text. Checklist marks SHALL convey checked and unchecked states without being operable. Viewing the document MUST NOT write to the source file, stored capture, or task progress.

#### Scenario: The same Markdown plan on both surfaces

- **GIVEN** a capture named `sample-plan.md` with this content:

  ```markdown
  # Sample plan

  ## Next steps

  - [x] Write the draft
  - [ ] Review the draft

  **Note:** Review the sample only.
  ```

- **WHEN** the user opens Plan document in the sidebar and in Pages → Agent Progress
- **THEN** both views show equivalent headings, a task list with distinguishable checked and unchecked marks, and a bold `Note:`
- **AND** neither pointer nor keyboard input can toggle a mark, and viewing leaves the file, capture, and reported progress unchanged

#### Scenario: The same text in a non-Markdown capture

- **WHEN** the user opens the same content captured as `sample-plan.txt` or with an unknown suffix in each surface
- **THEN** each surface shows literal text, including `#`, `- [x]`, `- [ ]`, and `**`

### Requirement: Preview preserves captured-version semantics

Both previews SHALL consume only the saved text returned by the existing on-demand document read. They MUST NOT read the live file, initiate capture, or change the API, storage, permissions, or capture lifecycle. Existing loading, retry, no-text, capture warnings, and synchronization qualifications SHALL remain visible when applicable. The board's comparison of recorded captures SHALL remain literal and separate from the preview.

#### Scenario: Source file differs from the recorded copy

- **WHEN** the bound file changes after capture without a new report and the user opens Plan document in each surface
- **THEN** the views show only the recorded copy and retain the qualification that the current file has not been rechecked

#### Scenario: No ready capture text

- **WHEN** the capture read is still loading, fails, or has no available body
- **THEN** each surface shows its existing applicable loading, error/retry, or unavailable message instead of fabricating a preview

#### Scenario: Earlier text remains readable

- **WHEN** the latest file check fails with a last good capture retained, or a newer capture is recorded while the earlier one is loading
- **THEN** each surface shows the available saved text, with the existing applicable last-good or earlier-capture warning, not as the live file

#### Scenario: Compare two Markdown captures

- **WHEN** the user opens Compare recorded captures on the board and selects two versions containing Markdown
- **THEN** the diff still shows literal markup and existing comparison qualifications

### Requirement: Captured Markdown is untrusted content

The preview MUST NOT activate embedded HTML or load document-supplied assets. Image syntax SHALL show only alternative text. Only valid absolute HTTP(S) links SHALL be actionable, and only on explicit activation; all other link labels SHALL remain inert text. Rendering MUST NOT trigger any document-originated network request or navigation.

#### Scenario: Captured markup and images on either surface

- **WHEN** either surface previews a capture containing embedded HTML and Markdown image references
- **THEN** no embedded HTML becomes active, images appear only as alternative text, and no resource is read or requested because of the document

### Requirement: Preview links are bounded and their outcome is visible

Destinations longer than 2,048 characters or containing a username or password MUST NOT be actionable. The title of an actionable link SHALL show its full destination. If the host cannot open an activated link, the preview SHALL show a localized error.

#### Scenario: URL activation on either surface

- **WHEN** either surface previews valid absolute HTTP(S) links alongside invalid, relative, protocol-relative, fragment-only, non-web, overlong or credential-bearing links
- **THEN** opening the preview does not request any destination
- **AND** only an explicit activation of a valid absolute HTTP(S) link opens its destination outside the progress surface, without an opener or referrer
- **AND** all other link labels remain non-interactive

#### Scenario: The host cannot open a link

- **WHEN** the user activates a valid link and the host cannot open it
- **THEN** the preview shows a localized error instead of failing silently
