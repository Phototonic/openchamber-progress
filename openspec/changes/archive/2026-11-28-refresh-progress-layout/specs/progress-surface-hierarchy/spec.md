## MODIFIED Requirements

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
- **THEN** its plan switcher shares the first line with Settings and plan More; Copy update and Handoff note each occupy a full-width button and the four segments form one full-width group
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

## ADDED Requirements

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
