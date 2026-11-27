## ADDED Requirements

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
