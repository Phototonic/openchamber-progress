## REMOVED Requirements

### Requirement: Default scope is the current session or selected plan
**Reason:** The board's only inbox entry now represents all eligible plans, whether or not a plan is selected.
**Migration:** Keep the rail and Work Status scoped to the current session; offer This plan as a filter inside the board list. No stored blocker or membership changes.

## ADDED Requirements

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

## MODIFIED Requirements

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
