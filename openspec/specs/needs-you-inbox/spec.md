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

Inbox reads SHALL be read-only, bounded and continuable through every eligible task. A count SHALL be shown as exact only with complete coverage and otherwise SHALL carry a plus mark. Continuation MAY run automatically within the existing per-window bounds, at most one window per existing refresh cycle and a fixed number per traversal. Refresh SHALL add no polling loop, per-task polling, notification or inference.

#### Scenario: Eligible task beyond the first read window
- **WHEN** bounded traversal has not reached an eligible task yet
- **THEN** the count carries a plus mark, the incomplete-count indicator is available and continuation reaches that task automatically or through Load more
- **AND** the UI does not claim a complete zero, lose the task at a window boundary or display it twice

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

### Requirement: Default scope is the current session or selected plan

On the rail and Work Status the inbox SHALL default to the plans of the current session, including plans that session helps with. On the board it SHALL default to the selected plan. All plans SHALL be an explicit secondary scope. The list MUST NOT switch scope by itself.

#### Scenario: This session has nothing but other plans do
- **WHEN** the default scope has no Needs you item and other plans in the verified source do
- **THEN** the surface shows nothing waiting in this scope and a quiet link naming how many items wait in other plans
- **AND** the list changes to all plans only when the user chooses it

#### Scenario: All plans
- **WHEN** the user selects the all-plans scope
- **THEN** every Needs you item of the verified source is listed with its plan name, with the same counts and plus-mark rules

#### Scenario: Session plan list is incomplete
- **WHEN** the session's own plan list was not fully loaded
- **THEN** the session-scoped count carries a plus mark rather than reading as exact

### Requirement: Compact Needs you presentation

The inbox SHALL be the same component on rail and board, placed below the map or list. Collapsed, it SHALL be one line with the count and the longest wait. Expanded, it SHALL show one line per item. Other blocked work SHALL appear only as a quiet count, never as a default list. The rail SHALL start collapsed and the board expanded unless a saved device state says otherwise.

#### Scenario: Collapsed line
- **WHEN** two items in scope need the user and the longest has waited 17 hours
- **THEN** one line states that two need the user and that the oldest has waited 17 hours, as a button exposing its expanded state

#### Scenario: Nothing in scope on the rail
- **WHEN** a complete read finds nothing needing the user in the rail's scope and no item in other plans
- **THEN** the rail shows no Needs you line at all

#### Scenario: Other blocked work
- **WHEN** four further tasks in scope are blocked without being Needs you items
- **THEN** the expanded list shows one quiet count for them, and selecting it points to those tasks in the plan shown

#### Scenario: Read failed
- **WHEN** the inbox cannot be read
- **THEN** one plain line says it could not be checked and offers a retry, never an empty state

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

An opened item SHALL offer Hide where device storage is supported. A hidden item SHALL be excluded from the list and count on that device until its reported blocker details change, then return by itself. Hiding MUST NOT change any reported data or other devices. The number hidden SHALL stay visible with a way to show and unhide them.

#### Scenario: Hide and undo
- **WHEN** the user hides an item
- **THEN** the count drops at once, a line says it is hidden until the task changes and offers Undo, and the change is announced once

#### Scenario: Reported state changes
- **WHEN** the main session reports new details for a hidden task
- **THEN** the task is listed and counted again without user action
- **AND** an unrelated report on the same plan does not unhide it

#### Scenario: Hidden items stay reachable
- **WHEN** one or more items are hidden
- **THEN** the expanded list and the More menu state how many are hidden and let the user show and unhide them

#### Scenario: Device storage unsupported
- **WHEN** the host does not advertise device storage
- **THEN** Hide is not offered and no item is hidden
