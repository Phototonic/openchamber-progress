## RENAMED Requirements

- FROM: `### Requirement: Exactly three view states are remembered per device`
- TO: `### Requirement: Bounded view states include the quiet-plan filter`

## MODIFIED Requirements

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

## ADDED Requirements

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
