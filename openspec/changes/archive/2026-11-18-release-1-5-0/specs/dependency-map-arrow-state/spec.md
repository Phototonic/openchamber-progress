## MODIFIED Requirements

### Requirement: Arrow meaning has a textual equivalent

Arrows SHALL remain decorative and absent from accessible names and focus order. The map's help-and-filters control SHALL explain working beads, blocked bars, skipped dashes and quiet done arrows in plain words, including that looping motion means work in progress as reported, not progress made. A current waiting task's selected-task summary SHALL count its in-progress and blocked direct prerequisites without new motion announcements.

#### Scenario: Waiting-task summary
- **WHEN** a selected pending task on an eligible picture has three unfinished direct recorded prerequisites, one working, one blocked and one pending
- **THEN** the summary states that it waits on three earlier tasks, one in progress and one blocked
- **AND** counts include prerequisites hidden by filters, count each direct task once, exclude transitive/group relationships, omit zero subcounts and preserve singular wording

#### Scenario: Skipped prerequisite
- **WHEN** the waiting task also has a skipped prerequisite
- **THEN** the summary preserves the skipped-work warning alongside any in-progress/blocked count

#### Scenario: Unavailable guidance
- **WHEN** the picture loses current guidance or the plan closes
- **THEN** no new waiting-state summary is presented as current
- **AND** the existing historical/pending explanation and relationship list remain

#### Scenario: Accessible navigation and silence
- **WHEN** motion starts, stops or changes phase during a repaint
- **THEN** card accessible names, keyboard navigation, focus and the map live region do not change because of motion
- **AND** keyboard users can read the arrow key through the help-and-filters control and use the ordinary list alternative
