# large-library-responsiveness Specification

## Purpose
Keep the full page responsive and its plan list scrollable with a large plan library, without changing the facts shown, the read routes or the polling cadence.

## Requirements

### Requirement: The full page stays responsive with a large library

With the reference library of 500 loaded plans, a background refresh on the full page SHALL stay within the release budget. A refresh that changes nothing shown MUST NOT rebuild the page, and the work of one refresh MUST NOT grow with the number of plan rows multiplied by the number of held Needs you items. The rail SHALL stay as responsive as before.

#### Scenario: Idle page with nothing reported
- **WHEN** the full page shows the reference library with a 60-task map open and no report arrives for 16 seconds
- **THEN** main-thread tasks longer than 50 ms total at most 1,000 ms and none is longer than 250 ms

#### Scenario: Selecting another plan
- **WHEN** the user selects another loaded plan whose detail is not cached
- **THEN** its complete detail and map are shown within 1,500 ms

#### Scenario: Small library
- **WHEN** the full page shows a library of about ten plans with the same map
- **THEN** no main-thread task longer than 50 ms occurs while idle, as before the change

#### Scenario: Rail
- **WHEN** the rail shows the same map over the reference library, idle or during a map gesture
- **THEN** no main-thread task longer than 50 ms occurs and the 99th-percentile frame gap is at most 50 ms

#### Scenario: Budget missed
- **WHEN** a measured figure exceeds its budget after the change
- **THEN** the figure is reported with the baseline and the change is not released as meeting this requirement until the design is amended

### Requirement: Map gestures are not stalled by refreshes

On the full page, dragging, wheel panning and zooming the map SHALL stay smooth while background refreshes run. A refresh that does not change the selected plan's picture MUST NOT end the gesture, move the view or recompute the layout.

#### Scenario: Dragging the map
- **WHEN** the user drags the map with 150 pointer moves across several refreshes on the reference library
- **THEN** the 99th-percentile frame gap is at most 150 ms and main-thread tasks longer than 50 ms total at most 1,000 ms

#### Scenario: Wheel panning
- **WHEN** the user pans with 120 wheel events across several refreshes
- **THEN** the 99th-percentile frame gap is at most 150 ms

#### Scenario: Keyboard zoom
- **WHEN** the user zooms with thirty key presses
- **THEN** no main-thread task is longer than 250 ms and the view ends at the zoom the keys asked for

### Requirement: Scrolling the plan list survives refreshes

The plan list's scroll container SHALL remain the same connected element across background refreshes, so a scrollbar drag, wheel or touch scroll in progress continues. Freshness MUST NOT be deferred without bound to protect a gesture, and a change of store, account, binding or board reading SHALL still replace the list at once.

#### Scenario: Dragging the scrollbar across refreshes
- **WHEN** the user drags the plan list's scrollbar with a mouse for longer than two refresh cycles on a list taller than its frame
- **THEN** the list follows the pointer for the whole drag and reaches at least 90% of the distance the same drag reaches with refreshes paused

#### Scenario: Release outside the frame
- **WHEN** the mouse button is released outside the frame
- **THEN** the drag ends and the next refresh paints normally

#### Scenario: A plan changes during the drag
- **WHEN** a plan's reported progress changes while the scrollbar is being dragged
- **THEN** its row shows the new state without ending the drag

#### Scenario: Authority changes during the drag
- **WHEN** the store, account, binding or board reading changes during the drag
- **THEN** the retired list is replaced at once and none of its rows stays actionable

### Requirement: Faster painting shows the same facts

Reused derived results SHALL give the same shown plans, order, grouping, selection, filter choices and per-plan Needs you counts as direct evaluation, and SHALL be recomputed whenever an input they depend on changes. They MUST NOT be keyed on the progress revision alone. Duplicate-identifier ambiguity, source trust and worktree placement rules MUST NOT be weakened.

#### Scenario: Equal results
- **WHEN** the fixture library is painted with reused results and evaluated directly
- **THEN** the shown plans, their order and groups, the selection and each plan's Needs you count are identical

#### Scenario: Live membership changes without a new report
- **WHEN** a session or worktree appears or disappears while no plan revision changes
- **THEN** the affected plans move to their new project or worktree group on the next paint

#### Scenario: Other inputs change
- **WHEN** the binding or source trust, a filter, the current or archived view, the search run or the interface language changes
- **THEN** the next paint shows the plans, groups, choices and labels for the new value

#### Scenario: An item is hidden on this device
- **WHEN** the user hides a Needs you item
- **THEN** that plan's row count drops on the next paint

#### Scenario: Same identifier in two sources
- **WHEN** two sources hold plans or sessions with equal identifiers
- **THEN** each plan keeps its own source's placement and neither borrows the other's session title or project

### Requirement: No new polling or larger reads

The change MUST NOT add a timer, a polling loop, a route or a service capability, and MUST NOT raise the number or size of reads a refresh sends.

#### Scenario: Idle traffic
- **WHEN** the full page idles on the reference library
- **THEN** each refresh sends no more than ten list pages, one health read, one inbox window and one runs page, as before the change

#### Scenario: Hidden frame
- **WHEN** the frame is hidden
- **THEN** it sends nothing and paints nothing, as before the change
