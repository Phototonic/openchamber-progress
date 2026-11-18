# subagent-loss-notices Specification

## Purpose
Separate enduring incomplete run coverage from recent recording gaps that deserve attention, with durable store-wide acknowledgement and safe upgrade behaviour.

## Requirements

### Requirement: Durable last-detection metadata

The backend SHALL preserve the permanent loss indication and atomically record the latest committed loss detection's backend wall-clock time and monotonically increasing acknowledgement sequence. A subsequent detection MUST remain distinguishable from a dismissed detection even when timestamps are equal or move backwards. Failure to persist MUST NOT be reported as successful recording or acknowledgement.

#### Scenario: A later loss has the same timestamp
- **WHEN** a loss is dismissed and another loss is committed in the same millisecond
- **THEN** the later loss has a greater sequence and is not acknowledged by the previous dismissal
- **AND** the permanent coverage gap remains present

#### Scenario: Loss metadata cannot be committed
- **WHEN** the store rejects a loss-state write
- **THEN** the transaction rolls back and no persisted detection date is invented
- **AND** passive recording failure does not abort or modify native execution

### Requirement: Validated non-destructive migration

Only explicit companion activation SHALL initialize or upgrade run storage. The backend SHALL migrate the exact supported version-1 shapes atomically to run format 2, preserving run and progress evidence, capture generation and the permanent loss bit. Unknown, partial, corrupt or future shapes MUST fail closed without repair. Existing loss without a known detection date MUST remain unknown-date and non-attention after migration.

#### Scenario: Upgrade an existing loss flag
- **WHEN** an exact supported version-1 store with loss set is activated by the new companion
- **THEN** its existing records and loss qualification are preserved
- **AND** the gap is disclosed as predating the update without a fabricated date or recent cue

#### Scenario: Upgrade a store with no loss
- **WHEN** an exact supported version-1 store without loss is activated
- **THEN** no loss, date, dismissal or attention is invented
- **AND** a subsequent real detection can produce a dated recent notice

#### Scenario: Upgrade fails during replacement
- **WHEN** any migration DDL or singleton write fails
- **THEN** the complete original schema and data remain usable by the original binary after rollback
- **AND** repeated successful activation does not migrate or reset the store again

#### Scenario: Read without activation
- **WHEN** the new service reads an exact current epoch-bearing version-1 store, or a store without the run extension
- **THEN** it performs no migration
- **AND** version-1 reads retain their legacy notice limitations while absence remains unavailable, never a certified zero count

### Requirement: Service-authoritative 24-hour attention

The service SHALL raise loss attention only for a dated, undismissed detection with wall-clock age less than 24 hours. It SHALL treat negative age as zero and unknown date as non-recent. Browser clocks MUST NOT decide attention. Time passing MUST NOT change run outcomes, task progress, permanent coverage or stored revision.

#### Scenario: Attention expires at the boundary
- **WHEN** a successful read is taken exactly 24 hours after the last undismissed detection
- **THEN** attention is false and the original detection date and incomplete coverage remain disclosed

#### Scenario: Machine clock moves backwards
- **WHEN** the service clock is earlier than the last detection timestamp
- **THEN** the detection has effective age zero for attention
- **AND** a persisted dismissal still quiets its sequence regardless of clock correction

### Requirement: Store-wide fenced dismissal

Rail and board SHALL permit an explicit acknowledgement of the observed loss sequence through the existing authenticated guest-to-service transport. The service MUST validate current store/source binding and known-root identity, reject malformed or unbounded inputs, and serialize the acknowledgement with loss writes. Acknowledgement MUST NOT alter run facts, progress, capture enablement, permanent loss or the recovery queue.

#### Scenario: Dismiss on one surface
- **WHEN** the user dismisses the current loss in the rail and the write succeeds
- **THEN** that sequence is durably acknowledged for the entire store, including other roots and future visits
- **AND** the initiating view quiets on acknowledgement while other open views converge on their next successful ordinary refresh
- **AND** a separate store remains unchanged

#### Scenario: A new loss wins the race
- **WHEN** a new loss commits before an acknowledgement of an older unacknowledged sequence
- **THEN** the service refuses the stale acknowledgement without dismissing the newer loss
- **AND** the guest refreshes the notice instead of claiming success

#### Scenario: Repeat an acknowledgement after another loss
- **WHEN** an already-acknowledged sequence is submitted again after a newer loss
- **THEN** the service returns a successful no-op with current metadata
- **AND** the newer loss remains unacknowledged and no extra revision change is caused by the retry

#### Scenario: Capture is disabled or the write fails
- **WHEN** a supported store has capture disabled
- **THEN** its existing loss may still be acknowledged without enabling recording
- **AND WHEN** the acknowledgement instead fails to commit
- **THEN** the UI retains the notice and offers error feedback without claiming persistence

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

### Requirement: Additive protocol and truthful mixed-version behaviour

The change SHALL keep base protocol/schema 2 and `subagentRuns:1`, expose validated format-2 notice metadata additively, and preserve legacy loss and coverage fields. New guests MUST distinguish absent legacy metadata from invalid format-2 metadata. Old run-aware binaries MUST NOT be made to modify the new store by weakening schema checks or deleting state.

#### Scenario: New guest reads an older service
- **WHEN** a supported legacy reply has loss but no notice metadata
- **THEN** the new guest shows an unknown-date muted qualification without a dismissal action or recent loss line
- **AND** it does not invent a detection date or assert that the loss preceded an update

#### Scenario: Old guest reads a new service
- **WHEN** an existing guest parses the additive format-2 reply
- **THEN** its existing loss/coverage fields remain meaningful and it does not falsely claim completeness
- **AND** its older attention presentation is not represented as supporting dismissal

#### Scenario: Downgrade after migration
- **WHEN** an older run-aware binary opens the upgraded extension
- **THEN** its exact schema validation may refuse health, capture or run reads without rewriting stored state
- **AND** recovery guidance requires compatible binaries rather than destructive down-migration

#### Scenario: Malformed notice metadata
- **WHEN** format-2 metadata has an invalid time, sequence relationship, attention value or missing required fields
- **THEN** the adapter rejects the reply rather than classifying it as a quiet legacy gap
