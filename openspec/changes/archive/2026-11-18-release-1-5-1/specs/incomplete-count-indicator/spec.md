## MODIFIED Requirements

### Requirement: Possibly low counts are never shown as exact

A positive count that an active reason can raise SHALL carry a plus mark directly after the number, in all three languages, dismissed or not. A plus mark MUST NOT appear on zero or on a count no reason can raise, and a zero count SHALL have no badge. A count MUST NOT be shown as an exact positive number, nor a zero as a verified empty result, unless its own coverage is complete. A count SHALL stay marked when no reason is shown to leave it unaffected.

#### Scenario: Partial Needs you count
- **WHEN** five items are known and some plans of the scope are unchecked
- **THEN** the line reads five-plus, and the longest wait reads as a lower bound

#### Scenario: Incomplete zero
- **WHEN** no item is known yet and some plans of the scope are unchecked
- **THEN** no number and no plus mark are shown, the surface does not say that nothing needs the user, and the incomplete-count indicator is available

#### Scenario: Plan rows on the board
- **WHEN** the Needs you read is incomplete and the board lists plans with two, one and no known items
- **THEN** only the first two rows show a count and the third shows no badge
- **AND** a row whose plan's items were fully read shows its number without a plus mark, while a row whose plan may have more shows the plus

#### Scenario: Partial sub-agent count
- **WHEN** recorded history is only partly reconciled, while the host's current session list is complete and every recorded child is loaded
- **THEN** the finished, failed, interrupted and unknown counts that are positive carry the plus mark
- **AND** the running and waiting counts do not, because every currently active child is either recorded or listed by the host

#### Scenario: Sub-agent counts with incomplete current activity
- **WHEN** the host's session list is cut short or unavailable while recorded history is complete
- **THEN** the running and waiting counts that are positive carry the plus mark and the completed counts do not

#### Scenario: Work Status
- **WHEN** the selected session's Needs you count is zero and the read is incomplete
- **THEN** Work Status shows no Needs you part, not a zero with a plus mark

#### Scenario: Dismissed indicator
- **WHEN** the user has dismissed the indicator
- **THEN** affected counts keep their plus mark
