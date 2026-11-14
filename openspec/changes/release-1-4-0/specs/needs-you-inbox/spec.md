## ADDED Requirements

### Requirement: Source-wide reported attention

The inbox SHALL enumerate each explicitly blocked task once across active visible plans of the verified source. Valid current decision/review categories SHALL count as Needs you. Remaining categories, missing/unknown annotations and unusable annotations SHALL appear separately as Also blocked with honest labels. Closed, archived, deleted, group and unverified-source records MUST NOT enter either group.

#### Scenario: Mixed plans and categories
- **WHEN** several active plans report decision, review, external, dependency, other and unclassified blockers
- **THEN** only decision/review tasks contribute to the Needs you count and all other eligible blocked tasks appear in Also blocked
- **AND** equal task or plan identifiers in different sources do not collide or leak across the verified binding

#### Scenario: No person-facing blockers
- **WHEN** a complete verified read contains no decision/review blockers
- **THEN** the inbox clearly states that no reported items need the user, even if Also blocked contains tasks
- **AND** a failed, unsupported or incomplete read is not presented as a verified empty result

### Requirement: Honest bounded inbox reads

Inbox reads SHALL be read-only, bounded and continuable through every eligible task. Coverage and counts SHALL distinguish complete data from partial, gapped, stale or unavailable data. Refresh SHALL reuse existing scheduling without extra polling loops, per-task polling, notifications or inference.

#### Scenario: Eligible task beyond the first read window
- **WHEN** bounded traversal has not reached an eligible task yet
- **THEN** the UI discloses incomplete coverage and permits continuation to that task
- **AND** it does not claim a complete zero, lose the task at a page boundary or display it twice

#### Scenario: Source or revision changes
- **WHEN** identity changes or a pinned record changes during continuation
- **THEN** stale requests/results are retired or the continuation visibly restarts
- **AND** no cross-revision detail is silently assembled

### Requirement: Reported details and safe navigation

Each row SHALL identify plan/task, reported reason, next action and history-derived waiting time when available. Unknown values SHALL remain unknown. Selecting a row SHALL open and reveal the current task in a clearly labelled reading without changing status, authority, host session or draft. Work Status SHALL expose a discoverable count entry into the compact panel inbox.

#### Scenario: Read a waiting task
- **WHEN** the user selects an inbox row
- **THEN** its source-qualified plan/task is revalidated and brought into view, or removal/unavailability is explained
- **AND** exact, lower-bound and unavailable waiting time retain their existing reported-history meanings

#### Scenario: Accessible phone-width inbox
- **WHEN** the inbox is used with keyboard, touch, English/Russian, light/dark or a phone-width layout
- **THEN** group labels, empty/error states and actions remain readable and operable with visible focus
- **AND** no control mutates a task from the inbox
