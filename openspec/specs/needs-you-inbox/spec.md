# needs-you-inbox Specification

## Purpose
Bring reported decision and review blockers across active plans into one bounded, read-only inbox with honest coverage and safe navigation to the original task.

## Requirements

### Requirement: Source-wide reported attention

The inbox SHALL enumerate each explicitly blocked task once across active visible plans of the verified source. A task SHALL count as Needs you only when its valid current category is decision or review and it meets the main-session membership requirement. Every other eligible blocked task SHALL be counted apart as other blocked work, with honest labels. Closed, archived, deleted, group and unverified-source records MUST NOT enter either group.

#### Scenario: Mixed plans and categories
- **WHEN** several active plans report decision, review, external, dependency, other and unclassified blockers
- **THEN** only decision/review tasks that meet main-session membership contribute to the Needs you count, and all other eligible blocked tasks are counted as other blocked work
- **AND** equal task or plan identifiers in different sources do not collide or leak across the verified binding

#### Scenario: No person-facing blockers
- **WHEN** a complete verified read contains no Needs you item
- **THEN** the board states that nothing needs the user and the rail shows no Needs you line, even if other blocked work exists
- **AND** a failed, unsupported or incomplete read is not presented as a verified empty result

### Requirement: Honest bounded inbox reads

Inbox reads SHALL be read-only, bounded and continuable through every eligible task. On every surface and scope, including each board plan row, a positive Needs you count SHALL be exact only with complete coverage of what it counts and otherwise carry a plus mark. A zero count MUST NOT carry a plus mark or a badge; while coverage is incomplete it SHALL show no number and MUST NOT be presented as a verified empty result.

#### Scenario: Eligible task beyond the first read window
- **WHEN** bounded traversal has found some items and has not reached an eligible task yet
- **THEN** the count carries a plus mark, the incomplete-count indicator is available and continuation reaches that task automatically or through Load more
- **AND** the UI does not claim a complete zero, lose the task at a window boundary or display it twice

#### Scenario: Nothing found yet
- **WHEN** bounded traversal has found no item and has not covered every eligible plan
- **THEN** the Needs you line shows no number and no plus mark, and does not state that nothing needs the user
- **AND** the incomplete-count indicator is available and continuation proceeds as for a positive count

#### Scenario: Plan rows
- **WHEN** the board lists plans while the traversal is incomplete
- **THEN** a row shows a Needs you count only when its plan has at least one known item
- **AND** the count carries a plus mark only when that plan's own items may not be fully read

#### Scenario: Source or revision changes
- **WHEN** identity changes or a pinned record changes during continuation
- **THEN** stale requests/results are retired or the traversal restarts
- **AND** no cross-revision detail is silently assembled and the count is not exact until a traversal completes again

#### Scenario: Automatic continuation stays bounded
- **WHEN** the inbox is incomplete in a visible frame across several successful refreshes
- **THEN** each refresh sends at most one inbox request, and automatic continuation stops at its fixed per-traversal window limit
- **AND** further windows load only on an explicit Load more, one window per activation

#### Scenario: Hidden frame
- **WHEN** a frame is hidden while its inbox is incomplete
- **THEN** it requests no continuation and discards any reply still in flight

### Requirement: Reported details and safe navigation

Each item SHALL be one line naming the task, its kind and its history-derived waiting time, with the plan named in the all-plans scope. Opening an item SHALL show its reported reason and next action literally and in place, without changing status, authority, host session or draft. Unknown values SHALL remain unknown. Work Status SHALL show the selected session's Needs you count and open the panel from it.

#### Scenario: Read a waiting task
- **WHEN** the user opens an inbox item
- **THEN** its kind, waiting time and the agent's own reason and next action appear inside the list, with one item open at a time
- **AND** exact, lower-bound and unavailable waiting time retain their existing reported-history meanings
- **AND** when the plan shown is that item's plan, its task is selected on the map or revealed in the list without a separate pinned reading

#### Scenario: An opened item changes or leaves
- **WHEN** a later read no longer contains the opened item, or its details changed
- **THEN** the opened item closes or shows the current details, and the removal is not presented as the user's action

#### Scenario: Accessible phone-width inbox
- **WHEN** the inbox is used with keyboard, touch, English, Russian or Simplified Chinese, light/dark or a phone-width layout
- **THEN** the line, items, empty and error states and actions remain readable and operable with visible focus
- **AND** Escape closes an opened item and returns focus to its line, and no control mutates a task from the inbox

### Requirement: Only a plan's main session supplies Needs you items

A blocked task SHALL be a Needs you item only when the session that reported its current blocker details is the plan's main session and that session is recorded as top-level, with no parent session. A task failing this, or whose main session's parent status is unknown, MUST NOT be shown or counted as needing the user on any surface. It SHALL remain a blocked task with its reported details on its task in the list and the map.

#### Scenario: Sub-agent reports a decision on its assigned task
- **WHEN** a sub-agent reports its assigned task blocked with a decision or review category, directly or together with its final handoff
- **THEN** the task is not listed or counted as Needs you
- **AND** it stays blocked on its task row and map card with its reason and next action, and is counted as other blocked work

#### Scenario: Sub-agent owns the plan
- **WHEN** a session that has a parent session started the plan and reports a decision blocker addressed to its parent
- **THEN** no task of that plan is a Needs you item while that session remains its main session

#### Scenario: Main session reports for a sub-agent
- **WHEN** a top-level main session reports a decision or review blocker on a sub-agent's task, including as a relay attributed to that sub-agent
- **THEN** the task is a Needs you item

#### Scenario: Details change hands
- **WHEN** a sub-agent replaces blocker details that the main session wrote
- **THEN** the task leaves Needs you on the next accepted read and stays blocked
- **AND** it returns only when the main session reports its details again

#### Scenario: Blockers stored before the upgrade
- **WHEN** a store already holds decision or review blockers that sub-agents reported
- **THEN** they are classified by this rule on the first read, without rewriting, migrating or deleting any stored record
- **AND** they remain visible as blocked tasks with their details

#### Scenario: Service cannot supply the main-session fact
- **WHEN** inbox rows arrive without the main session's top-level fact
- **THEN** Needs you is reported unavailable rather than classified without it or shown as empty

#### Scenario: Waiting sub-agent sessions
- **WHEN** the host shows a sub-agent session waiting on a question or permission
- **THEN** that session is counted only on the sub-agents line and adds nothing to the Needs you count

### Requirement: Compact Needs you presentation

The board SHALL expose one inbox disclosure at its top-bar count; the rail SHALL retain its disclosure below Map/List. Both start collapsed without a saved choice, share the existing rows and actions, and show other blocked work only as a quiet count. The oldest known wait SHALL remain available inside the board list and on the rail count line. Positive incomplete counts carry a plus; unknown coverage MUST NOT become verified zero.

#### Scenario: Collapsed line
- **WHEN** two items in scope need the reader and the oldest known wait is 17 hours
- **THEN** the board trigger names Needs you and its global count; the rail line states its scoped count and oldest wait; each trigger exposes its expanded state

#### Scenario: Nothing in scope on the rail
- **WHEN** a complete successful read finds nothing in the rail scope or other plans, with nothing hidden
- **THEN** the rail displays no Needs you line

#### Scenario: Other blocked work
- **WHEN** four further tasks are blocked without qualifying for Needs you
- **THEN** the expanded inbox shows their quiet count and retains its action pointing to those tasks on the plan shown

#### Scenario: Read failed
- **WHEN** a read fails or has not found an item yet in an incomplete traversal
- **THEN** the failure offers the existing recovery without a zero count; incomplete zero shows no number, plus badge or claim of no items

### Requirement: Open session and Copy reply never resolve an item

An opened item SHALL offer Open session, which asks the host to open the plan's main session, and Copy reply, which copies a short reply frame naming the task and plan. Neither action SHALL send a message, change a task, mark an item resolved or remove it. An item SHALL leave only when a later report changes it.

#### Scenario: Open session
- **WHEN** the user chooses Open session for an item whose main session the host lists for the verified source
- **THEN** the host is asked to open that session and nothing is sent, drafted or reported

#### Scenario: Session cannot be opened
- **WHEN** the main session is not listed by the host or the open gate does not hold
- **THEN** Open session is not offered, one plain line says why, and Copy reply remains

#### Scenario: Copy reply
- **WHEN** the user chooses Copy reply
- **THEN** the clipboard receives the reply frame with the agent's task and plan titles unchanged, and the control confirms only after the clipboard accepts
- **AND** on a clipboard failure the same text is shown for manual selection

#### Scenario: After acting
- **WHEN** the user has opened the session or copied a reply and no new report has arrived
- **THEN** the item is still listed and counted

### Requirement: Hide an item on this device until its reported state changes

An opened item SHALL offer Hide where device storage is supported. Hidden items SHALL not count or appear in the ordinary list on that device until their reported blocker details change. The expanded inbox itself SHALL state how many are hidden and allow showing and unhiding them, without a More-menu entry. Hiding MUST NOT modify reports or other devices.

#### Scenario: Hide and undo
- **WHEN** the reader hides an item
- **THEN** it leaves its applicable counts, one announcement explains the device hide, and Undo remains available

#### Scenario: Reported state changes
- **WHEN** the main session reports new blocker details for a hidden task
- **THEN** it returns automatically; an unrelated report does not unhide it

#### Scenario: Hidden items stay reachable
- **WHEN** only hidden items remain
- **THEN** the inbox on the board or rail remains reachable and its expanded list can show and unhide them without visiting Settings or plan More

#### Scenario: Device storage unsupported
- **WHEN** the host does not advertise device storage
- **THEN** Hide is not offered and no item is hidden

### Requirement: Automatic inbox continuation adds no polling

Continuation MAY run automatically within the existing per-window bounds, at most one window per existing refresh cycle and a fixed number per traversal. Refresh SHALL add no polling loop, per-task polling, notification or inference.

#### Scenario: Refresh of an incomplete inbox
- **WHEN** a refresh runs while the inbox is incomplete
- **THEN** it starts no polling loop, per-task polling, notification or inference beyond the bounded continuation

### Requirement: Board attention is global and rail attention is session-first

The board top-bar count SHALL cover all eligible items in the verified source regardless of search, filters, archive mode or selection. Its list SHALL open on All plans and offer This plan when selected. The rail and Work Status SHALL retain current-session scope including contributed plans, with explicit widening on the rail. The list MUST NOT change the selected plan or session, or lose an explicit scope on repaint within the same reading.

#### Scenario: Read across the board
- **WHEN** two eligible visible items belong to different plans and only one of those plans is displayed
- **THEN** the top count includes both; opening it shows the list on All plans with plan names
- **AND** choosing This plan narrows the list, not the top count; there is no second inbox under the board plan

#### Scenario: No selected plan
- **WHEN** a board search or Archived view has no selected plan
- **THEN** the same top entry still gives access to the source-wide inbox, without implying hidden or filtered-out rows are absent from the source

#### Scenario: Session scope
- **WHEN** the rail's session has no waiting item but other plans do
- **THEN** its quiet link offers the other plans without widening automatically; a positive session count of uncertain coverage carries a plus
