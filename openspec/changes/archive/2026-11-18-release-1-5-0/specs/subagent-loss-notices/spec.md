## MODIFIED Requirements

### Requirement: Permanent coverage disclosure independent of attention

An old or dismissed loss SHALL remain in `coverage.reasons` as `capture-loss` and keep coverage incomplete. Affected counts SHALL keep their plus mark, and the loss with its detection date SHALL stay listed in Advanced details and named in the support summary. A section containing the loss MUST NOT expose itself as complete merely because its indicator was dismissed or its attention ended.

#### Scenario: Dismissal does not repair counts
- **WHEN** a recent loss is acknowledged
- **THEN** retained counts and run/task facts do not change
- **AND** the date, the plus marks and the incomplete-section marker remain

#### Scenario: Recovery completes after loss
- **WHEN** history reconciliation finishes after a recorded gap
- **THEN** the loss qualification remains because recovery does not establish that all missing information was restored

### Requirement: Surface-specific accessible presentation

Rail and board SHALL present a recording gap through the single incomplete-count indicator, in neutral tone. A gap needing attention SHALL bring a dismissed indicator back and SHALL be named in its expanded text; dismissing it then SHALL send the store-wide acknowledgement. Work Status SHALL offer no dismissal control and no separate loss line. The UI MUST retain section eligibility, keyboard access and identity-bound focus behaviour.

#### Scenario: Recent, old and legacy gaps
- **WHEN** an eligible section has a recent undismissed gap
- **THEN** rail and board show the indicator even if it was dismissed on this device, its expanded text names the gap, and affected counts carry a plus mark
- **AND WHEN** that gap ages out, is dismissed, or is a migrated unknown-date gap
- **THEN** it no longer brings a dismissed indicator back, the plus marks remain and Work Status shows only the plus marks

#### Scenario: A response arrives after navigation
- **WHEN** a dismissal/read reply belongs to a retired store, binding, account, root or hidden/disposed visit
- **THEN** it cannot repaint the new reading, restore old attention or submit another mutation
- **AND** an already-sent acknowledgement affects only its captured store and sequence
