## ADDED Requirements

### Requirement: Refusal guidance rests on validated receipt evidence

Before coordinator guidance infers from a delegation receipt that cleanup retired a waiting delegation, the receipt SHALL be checked as the per-plan reader checks it: a pending declaration names no dispatch, a reserved declaration names one, and both name at least one task. A receipt that fails the check MUST NOT produce a refusal; it SHALL make the guidance incomplete, as other unreadable evidence does. The check MUST NOT change a receipt, the store or any reply.

#### Scenario: Reserved without a dispatch
- **WHEN** a restored plan's latest delegation receipt says reserved and names no dispatch, and its intent is gone
- **THEN** coordinator guidance reports no `closed` refusal for it and is marked incomplete

#### Scenario: Pending with a dispatch
- **WHEN** a restored plan's latest delegation receipt says pending and names a dispatch
- **THEN** coordinator guidance reports no refusal for it and is marked incomplete

#### Scenario: Pending or reserved with no tasks
- **WHEN** a restored plan's latest delegation receipt says pending or reserved and declares no task, and its intent is gone
- **THEN** coordinator guidance reports no refusal for it and is marked incomplete
- **AND** a cancelled declaration, which names no task by design, is still read as before

#### Scenario: Well-formed receipt after restore
- **WHEN** a restored plan's latest delegation receipt is pending without a dispatch, or reserved with one, and its intent was retired by cleanup
- **THEN** coordinator guidance reports the `closed` refusal as before

#### Scenario: Both readers agree
- **WHEN** the per-plan reader rejects a receipt because its dispatch disagrees with its state
- **THEN** coordinator guidance does not present that same receipt as complete evidence
