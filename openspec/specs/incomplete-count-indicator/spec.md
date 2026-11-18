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

Every count that may be low SHALL carry a plus mark directly after the number, in all three languages, whether or not the indicator is dismissed. A count MUST NOT be shown without the mark unless its coverage is complete.

#### Scenario: Partial Needs you count
- **WHEN** five items are known and some plans are unchecked
- **THEN** the line reads five-plus, and the longest wait reads as a lower bound

#### Scenario: Partial sub-agent count
- **WHEN** older runs are not fully loaded
- **THEN** the affected sub-agent counts carry the plus mark

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
