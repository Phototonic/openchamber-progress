## MODIFIED Requirements

### Requirement: Bounded view states include the quiet-plan filter

The extension SHALL continue to remember hidden Needs you items, rail/board Needs you expansion, incomplete-count dismissal and one shared quiet-plan filter on the device. The board's saved expansion SHALL apply to its relocated inbox. Other disclosures, filters, map and reading positions, selections and panels SHALL remain unstored apart from established language, History review points and per-session rail choice. Existing records MUST NOT be rewritten merely because controls moved.

#### Scenario: Reload
- **WHEN** the person reloads after successfully saving inbox expansion, hiding an item, dismissing the indicator and choosing a quiet filter
- **THEN** the saved states are respected in their existing scopes, including board expansion at its new location

#### Scenario: Defaults
- **WHEN** no state is saved
- **THEN** Needs you starts collapsed on the rail and at the board's top-bar count, nothing is hidden, the indicator shows when needed and quiet plans are hidden until the reader changes the filter

#### Scenario: Other reading state
- **WHEN** the reader changes a map filter or viewport, scrolls a list or document, or opens an item, then reloads
- **THEN** none of those reading positions, filters or opened items is restored from storage

#### Scenario: Quiet filter only lasts in this view
- **WHEN** the host does not support device storage
- **THEN** the quiet switch remains reversible in the current frame, and its tooltip and accessible description explain the choice is temporary without an extra line of copy
