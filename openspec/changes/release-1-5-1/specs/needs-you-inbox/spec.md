## MODIFIED Requirements

### Requirement: Honest bounded inbox reads

Inbox reads SHALL be read-only, bounded and continuable through every eligible task. A positive count SHALL be shown as exact only with complete coverage of what it counts and otherwise SHALL carry a plus mark. A zero count MUST NOT carry a plus mark or a badge; while coverage is incomplete it SHALL show no number and MUST NOT be presented as a verified empty result. This rule SHALL govern every Needs you count on every surface and scope, including the count on each board plan row. Continuation MAY run automatically within the existing per-window bounds, at most one window per existing refresh cycle and a fixed number per traversal. Refresh SHALL add no polling loop, per-task polling, notification or inference.

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
