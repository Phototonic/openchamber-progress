## ADDED Requirements

### Requirement: Exactly three view states are remembered per device

The extension SHALL remember on the device only these view states: hidden Needs you items, whether Needs you is collapsed or expanded on the rail and on the board, and dismissal of the incomplete-count indicator. Every other disclosure, filter, map position, selection and panel SHALL stay unstored, apart from the existing language choice and History review points.

#### Scenario: Reload
- **WHEN** the user expands Needs you on the rail, hides one item and dismisses the indicator, then reloads
- **THEN** Needs you is expanded, the item stays hidden and the indicator stays dismissed while its reasons are unchanged

#### Scenario: Defaults
- **WHEN** no state is saved
- **THEN** Needs you is collapsed on the rail and expanded on the board, nothing is hidden and the indicator is shown when needed

#### Scenario: Other reading state
- **WHEN** the user changes a map filter, zoom, selection or an opened item and reloads
- **THEN** none of those is restored

### Requirement: Device storage only, with honest failure

These states SHALL be saved only in host device storage, only when the host advertises it, as versioned bounded records. They MUST NOT be saved in instance, server or browser storage. A failed or malformed read SHALL fall back to the defaults without repairing the record, and a failed write MUST NOT be presented as saved.

#### Scenario: Host without device storage
- **WHEN** the host does not advertise device storage
- **THEN** no device request is sent, collapse and dismissal last only for the frame, and Hide is not offered

#### Scenario: Write fails
- **WHEN** saving a hidden item fails
- **THEN** the item is shown again with one plain line and a retry, and it is not reported as hidden

#### Scenario: Malformed record
- **WHEN** a saved record has an unknown version or shape
- **THEN** the defaults apply and the record is not overwritten until the user makes a new choice

#### Scenario: Bounded hidden list
- **WHEN** hidden entries reach their limit, or a complete read shows an entry's task no longer matches
- **THEN** the oldest or stale entries are removed, which can only make an item visible again

### Requirement: Saved view state never changes reported data or other contexts

Saving or reading these states MUST NOT change progress, start a progress read or affect another device. Hidden-item records SHALL be bound to their store, source, plan and task. Other open frames SHALL converge on their next existing refresh, with no cross-frame channel.

#### Scenario: Another store
- **WHEN** the device connects to a different store that has a task with the same plan and task identifiers
- **THEN** that task is not hidden

#### Scenario: Second frame
- **WHEN** an item is hidden on the rail while the board is open
- **THEN** the board reflects it after its next existing refresh, without an extra poll or message

#### Scenario: People sharing a profile
- **WHEN** two people use the same browser profile and installation
- **THEN** they share these states, and the documentation says so rather than promising per-person isolation
