# progress-surface-hierarchy Specification

## Purpose
Give the rail and board a shared reading order, with the map first when applicable, separate menus for plan actions and settings, and advanced facts out of the default view. Keep Work Status compact.

## Requirements

### Requirement: Map-first plan reading order

With a selected plan, the board and rail SHALL show one plan header, progress with done/total and a text legend, then one segmented control in the order Map, List, Document, History and its selected view. The rail SHALL retain session-scoped Needs you after Map/List; the board SHALL use its library-level inbox instead. Sub-agents and applicable incomplete-count indicators SHALL remain available.

#### Scenario: Plan with prerequisites
- **WHEN** complete supported detail includes a task-to-task prerequisite in a new reading at least 320 CSS pixels wide
- **THEN** Map opens under progress without an extra action

#### Scenario: Plan without prerequisites
- **WHEN** complete detail has no task-to-task prerequisite or the graph is unsupported
- **THEN** List opens and the view controls remain available

#### Scenario: Very narrow frame
- **WHEN** a new reading opens below 320 CSS pixels
- **THEN** it starts on List; all four views remain reachable without whole-page horizontal scrolling

#### Scenario: Wide board
- **WHEN** a plan with available summaries is selected
- **THEN** the header shows its title, one compact metadata line, Copy update as the single primary header action, Handoff note as a secondary action, and plan More
- **AND** both summary actions open the existing respective previews; only explicit Copy copies their displayed text
- **AND** at 820 CSS pixels or wider the board's list is a left column with per-plan attention counts and this header belongs to the detail column

#### Scenario: Plan actions on the rail
- **WHEN** the rail shows a selectable plan with available summaries
- **THEN** its plan switcher shares the first line with Settings and plan More; the next line starts with the quiet-plan switch and ends with Copy update and Handoff note as small buttons, which wrap below the switch when the rail is too narrow, and the four segments form one full-width group
- **AND** the quiet-plan switch is accessible with plan choice, including with a single choice, without adding an entry to either menu

#### Scenario: Explicit choice
- **WHEN** the reader explicitly selects a view while task detail is loading
- **THEN** the choice holds for the reading and is not persisted; completion does not switch back to the default or turn failure into empty success

#### Scenario: Open and close the document
- **WHEN** the reader selects Document
- **THEN** Document is the selected segment, the reader can choose another segment directly, and the document header receives focus on explicit entry
- **AND** Back or an unhandled Escape returns to the preceding plan view and restores focus to Document; a background repaint does not repeat the focus move

#### Scenario: Selected-plan History
- **WHEN** the reader selects History on either surface
- **THEN** History shows the bounded revisions of that selected source-qualified plan, newest first with existing truncation and failure qualifications, not events from all plans
- **AND** on the board its eligible pinned digest stays above Revisions, with explicit Refresh, Mark reviewed and View current task; opening History alone never acknowledges review
- **AND** on the rail History shows recorded revisions only, without reading a digest or review point or offering review actions; List Activity stays separate

### Requirement: One More menu for secondary content

For a selected plan, More SHALL contain only Sessions and, when eligible, Finish as cancelled. A separately named Settings gear SHALL offer only Language, Setup and Troubleshooting, identically on board and rail, independently of plan availability. Eligible single-plan cleanup SHALL remain reachable in its contextual controls, not in either menu. Hidden items SHALL remain reachable in Needs you.

#### Scenario: Panels replace the view
- **WHEN** the reader opens Sessions, Setup or Troubleshooting
- **THEN** Back or an unhandled Escape returns to the preceding view and its actual opener: More for Sessions, Settings for Setup or Troubleshooting
- **AND** opening Setup reads status only and leaving it retires its presentation without authorizing another step

#### Scenario: Menu keyboard use
- **WHEN** the reader uses either named menu
- **THEN** only its popup is open; arrow keys and type-ahead work, Escape returns focus to its trigger, and rows have at least 44 CSS pixels of height on coarse pointers

#### Scenario: New history
- **WHEN** a saved board review point for this plan is older than the listed revision
- **THEN** the accessible new-history indicator appears on History, not More, without a new history read
- **AND** no indicator appears without a saved point or supported device storage

#### Scenario: Before setup or after a failed read
- **WHEN** setup is incomplete, the session or plan is absent, or the progress read is loading or has failed
- **THEN** Settings still provides all three entries and directs the person to the existing recovery actions; without a plan there are no plan actions or view segments
- **AND** the rail's quiet filter remains reversible without a selected plan

#### Scenario: Explicit cancellation confirmation
- **WHEN** Finish as cancelled is chosen for an eligible plan
- **THEN** the existing inline confirmation identifies the plan, explains retained history and unfinished tasks, intentional reopening and that running agents are not stopped
- **AND** keeping it active or pressing Escape performs no write and returns focus to More

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

### Requirement: Library controls belong to the board

The board SHALL put the title, a wide plan/task search field when supported, the Hide quiet switch beside it and a compact Filters trigger in its top bar, with the all-plans Needs you count and Settings at the right on a wide screen. Below it, the browse list SHALL be plain rows grouped by project, with progress bars, a scoped active count and Select in the header when selection is available. Tidy SHALL be in the Finished area. No second search or bank of controls SHALL appear above the rows.

#### Scenario: Browse and narrow a multi-project library
- **WHEN** the reader changes Hide quiet, opens Filters, or expands a project's Finished group
- **THEN** quiet filtering retains its seven-day meaning; Current/Archived, locations and applicable search criteria remain reachable; each scoped plan row retains its lifecycle, accessible name, qualified attention and progress
- **AND** the active count excludes failed and other closed plans and identifies limited coverage rather than claiming a full library total

#### Scenario: Narrow or searching
- **WHEN** the board uses the narrow picker or displays search results
- **THEN** the top controls reflow without obscuring input, scope, results or Settings; Select and Tidy remain accessible with their existing eligibility
- **AND** Enter submits search but committing text with an input method does not; changing Hide quiet does not run a new search for the user

### Requirement: A document reader sized to its frame

The captured document SHALL use the remaining board or rail height. Back and filename SHALL share one line; retain the full accessible name or a localized fallback if absent. Show the capture age as a short localized note such as “Saved 22 h ago”. Current-file, synchronization and retained/earlier-capture qualifications SHALL remain explicit. Wide tables SHALL scroll sideways in their own box.

#### Scenario: Tall and short reading windows
- **WHEN** a long saved document is opened and the available frame height changes
- **THEN** the scrollable reading area grows beyond the old fixed limit when space permits and adapts when space shrinks; Back, capture status, the end of the document and applicable board comparison remain reachable

#### Scenario: Wide table in narrow Markdown
- **WHEN** a saved Markdown table has more columns than fit the frame
- **THEN** a keyboard or touch reader can reach its last column without horizontally scrolling surrounding paragraphs, the header or the page

#### Scenario: A saved copy is not the current file
- **WHEN** a file check failed after a successful capture, or an earlier version is returned during a newer capture
- **THEN** the displayed name, time and text describe the version being read; the failure or earlier-version qualification is visible, not replaced by a reassuring saved age

### Requirement: Reading positions last for one selected plan

Ordinary view changes between Map, List and Document SHALL retain each view's reading position in memory in its frame. These positions SHALL reset on a plan change (including leaving and returning), replacement reading identity, newer capture or frame disposal. A progress refresh of the same reading and capture MUST NOT by itself reset them. No persistence, progress read or focus move SHALL be introduced just to remember a position.

#### Scenario: Return by the view switch
- **WHEN** a reader pans and zooms the map, reads a task lower in List and scrolls partway through a long capture, then returns to each view on that plan
- **THEN** the same map area, task neighbourhood and document passage are available where left, subject to surviving content; no view borrows another view's offset
- **AND** an explicit request to reveal a task takes precedence over an old position

#### Scenario: Retire a position
- **WHEN** a reader selects another plan and returns, or a newer capture replaces the one being read
- **THEN** the previous positions are discarded and a late paint of old content cannot restore them

### Requirement: Quiet and stable visual hierarchy

The rail and board SHALL share a type scale, header pattern, spacing and control heights. Use host colour tokens and preserve system forced colours. Sections SHALL be distinguished by spacing rather than new cards, banners or borders around each group. Notices SHALL be one short line of copy, not stacked explanations; allow accessible reflow. The legend SHALL reserve its layout space during detail loading without announcing placeholder counts.

#### Scenario: Refresh does not move under the pointer
- **WHEN** board History is open and task detail resolves, filling the previously empty legend
- **THEN** the Refresh control stays in place and remains operable at the same pointer position; the legend shows only known facts

#### Scenario: Accessible hierarchy
- **WHEN** using keyboard, assistive technology, forced colours, 200% or 400% reflow, or English, Russian or Simplified Chinese
- **THEN** visual and focus order agree, controls have meaningful names and selected/expanded states, and actions and essential text remain reachable without clipping or whole-page sideways scrolling
