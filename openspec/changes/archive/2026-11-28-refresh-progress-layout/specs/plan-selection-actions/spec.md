## MODIFIED Requirements

### Requirement: An archived in-progress plan can be restored or deleted on its own

The selected plan's contextual cleanup controls, outside More, SHALL offer Restore and eligible Delete permanently for an archived plan whatever its lifecycle. For a visible closed plan they SHALL offer the existing Archive and Delete permanently actions. A visible in-progress plan MUST NOT gain per-plan cleanup: only the board's explicit selection flow can clean it up. Existing confirmations, capability gates, target binding and destructive consequences SHALL remain unchanged.

#### Scenario: Restore from More
- **WHEN** an archived in-progress plan is shown in Archived plans
- **THEN** Restore has moved out of More to the plan's contextual controls beside capability-gated Delete permanently, and Restore returns it to Current plans as in progress

#### Scenario: Delete declined
- **WHEN** the reader opens the plan's deletion confirmation and presses Escape
- **THEN** no request is sent and focus returns to the eligible deletion opener, not an unrelated menu

#### Scenario: Visible in-progress plan
- **WHEN** an unarchived in-progress plan is shown on rail or board
- **THEN** neither the header nor the contextual cleanup area offers single-plan Archive or Delete
