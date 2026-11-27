# device-remembered-view-state Specification

## Purpose
Remember a small, fixed set of view choices on the device, with honest failure when storage is unavailable, and never let a saved choice change reported data or another store or account.

## Requirements

### Requirement: Bounded view states include the quiet-plan filter

The extension SHALL remember hidden Needs you items, rail/board Needs you expansion, incomplete-count dismissal and one shared rail/board quiet-plan filter on the device. Other disclosures, filters, map positions, selections and panels SHALL stay unstored apart from established language, History review points and per-session rail choice. The new preference SHALL preserve existing view-state records.

#### Scenario: Reload
- **WHEN** the user expands Needs you on the rail, hides one item and dismisses the indicator, then reloads
- **THEN** Needs you is expanded, the item stays hidden and the indicator stays dismissed while its reasons are unchanged
- **AND** a successfully saved quiet-plan filter is restored too

#### Scenario: Defaults
- **WHEN** no state is saved
- **THEN** Needs you is collapsed on the rail and expanded on the board, no Needs you items are hidden and the indicator is shown when needed
- **AND** quiet plans are hidden on the rail and board until the person disables the filter

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

### Requirement: Quiet preference failures are honest and isolated

The quiet filter SHALL reuse host device-storage gating and existing refresh ownership, with no browser/server fallback or new polling. Failed reads SHALL use the enabled default with an explanation and without repairing storage; failed writes SHALL retain the confirmed choice or loaded default and report failure. Unsupported hosts SHALL permit frame-local filtering with an explicit persistence limitation. Older frames MUST NOT lose established view preferences because of the new record.

#### Scenario: Save and converge
- **WHEN** the person disables the filter on the rail and the save succeeds
- **THEN** a reload restores it and the board observes it through the next existing preference refresh
- **AND** no progress write occurs

#### Scenario: Unavailable storage
- **WHEN** device storage is unsupported, malformed or fails
- **THEN** the view states the limitation, never claims an unsaved choice was remembered, and follows the specified safe fallback

#### Scenario: Mixed guest versions
- **WHEN** an older frame reads its original view-state record after the filter was saved
- **THEN** its Needs you and incomplete-count preferences remain valid and unchanged
