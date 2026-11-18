## ADDED Requirements

### Requirement: Refusal guidance rests on validated receipt evidence

Before coordinator guidance infers from a delegation receipt that cleanup retired a waiting delegation, a pending or reserved receipt SHALL be checked as the per-plan reader checks it: pending names no dispatch, reserved names one, and both name at least one task. A receipt that fails MUST NOT produce a refusal; it SHALL make the guidance incomplete, as other unreadable evidence does. Other receipts SHALL be read as before. The check MUST NOT change a receipt, the store or any reply.

#### Scenario: Reserved without a dispatch
- **WHEN** a restored plan's latest delegation receipt says reserved and names no dispatch, and its intent is gone
- **THEN** coordinator guidance reports no `closed` refusal for it and is marked incomplete

#### Scenario: Pending with a dispatch
- **WHEN** a restored plan's latest delegation receipt says pending and names a dispatch
- **THEN** coordinator guidance reports no refusal for it and is marked incomplete

#### Scenario: Pending or reserved with no tasks
- **WHEN** a restored plan's latest delegation receipt says pending or reserved and declares no task, and its intent is gone
- **THEN** coordinator guidance reports no refusal for it and is marked incomplete

#### Scenario: Cancellation receipts are read as before
- **WHEN** a plan's latest delegation receipt is a cancellation, either the empty declaration that cancelled or the earlier declaration it retired, which keeps its tasks
- **THEN** coordinator guidance reads it as before this change: it reports no refusal for it and is not marked incomplete because of it

#### Scenario: Well-formed receipt after restore
- **WHEN** a restored plan's latest delegation receipt is pending without a dispatch, or reserved with one, names at least one task, its intent was retired by cleanup, and its declared tasks have not been verifiably recovered since
- **THEN** coordinator guidance reports the `closed` refusal as before

#### Scenario: Well-formed receipt whose tasks were recovered
- **WHEN** that same well-formed receipt is still the latest, and the plan's current assignment shows its declared tasks were explicitly linked since
- **THEN** coordinator guidance reports no refusal for it, as before this change

#### Scenario: Both readers agree
- **WHEN** the per-plan reader rejects a pending or reserved receipt because its dispatch disagrees with its state
- **THEN** coordinator guidance does not present that same receipt as complete evidence
