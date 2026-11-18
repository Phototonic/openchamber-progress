# incomplete-count-indicator Specification

## Purpose
Show every count that may be low through one calm indicator, never presenting a possibly low count as exact, while keeping the reasons and limits available to support.

## Requirements

### Requirement: One calm indicator for possibly incomplete counts

When any count on the rail or board may be low, the surface SHALL show exactly one neutral indicator, last in its content, with one sentence. It SHALL replace the Partial cue and every coverage, truncation, traversal, history-partial, not-checked and not-loaded notice. It MUST NOT use warning colour and MUST NOT state limit numbers.

#### Scenario: Several reasons at once
- **WHEN** older history is partly loaded, the host lists more sub-agents than are checked and some plans are unchecked
- **THEN** one indicator appears with one sentence, not one notice per reason

#### Scenario: Nothing incomplete
- **WHEN** every count on the surface is complete
- **THEN** no indicator is shown

#### Scenario: Expanded
- **WHEN** the user expands the indicator
- **THEN** one further sentence appears, with Load more when more can be loaded
- **AND** Load more requests one further bounded read and reports a failure in one line with a retry

#### Scenario: Screen reader
- **WHEN** the indicator appears or its expanded state changes
- **THEN** it is exposed as a named, expandable control, and its appearance is announced politely at most once per refresh

### Requirement: Possibly low counts are never shown as exact

A positive count that an active reason can raise SHALL carry a plus mark directly after the number, in all three languages, dismissed or not. A plus mark MUST NOT appear on zero or on a count that no active reason can raise, and a zero count SHALL have no badge. A count MUST NOT be shown as an exact positive number, nor a zero as a verified empty result, unless its own coverage is complete. When it cannot be shown that a reason leaves a count unaffected, that count SHALL stay marked.

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

### Requirement: Dismissal is remembered until the reasons change

The indicator SHALL be dismissible. Dismissal SHALL be remembered on the device until the set of reasons changes, then the indicator SHALL show again. A recording gap that needs attention SHALL be a reason of its own for each detection.

#### Scenario: Same reasons after reload
- **WHEN** the indicator was dismissed and the same reasons hold after a reload
- **THEN** it stays dismissed

#### Scenario: New reason
- **WHEN** a reason starts that was not active at dismissal, including a newer recording gap
- **THEN** the indicator shows again

#### Scenario: Recording gap while dismissing
- **WHEN** the indicator is dismissed while a recording gap needing attention is among its reasons
- **THEN** its expanded text names the gap, and dismissal also sends the existing store-wide acknowledgement
- **AND** a refused or failed acknowledgement leaves the indicator shown and says so

### Requirement: States that change what the user can do keep their own line

A failed or stale read, recording being off, and a plan from another OpenCode install MUST NOT be folded into the indicator. A failed read SHALL always be shown, SHALL NOT be dismissible and SHALL offer a retry.

#### Scenario: Failed read
- **WHEN** the latest read failed
- **THEN** a separate line states the time of the last successful update and offers a retry, whatever the indicator's state

#### Scenario: Recording off
- **WHEN** recording is off
- **THEN** a separate line says new progress is not saved and links to Setup

### Requirement: Limits and reasons stay available for support

The numeric limits and the kinds of active reasons SHALL NOT appear in default visible text. They SHALL be listed in Advanced details and in the support summary's appended lines.

#### Scenario: Support request
- **WHEN** a user with possibly incomplete counts copies the support summary
- **THEN** it names each active reason by a fixed word and states this build's limits
