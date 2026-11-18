## ADDED Requirements

### Requirement: Idle traffic is counted by when and in what order it was sent

The release gate's idle-traffic comparison SHALL count only requests sent inside the timed window, taken from the request log in the order they were sent. List pages and inbox requests SHALL be kept with the refresh whose first list page precedes them. Run reads SHALL be counted per window and shown as not compared per refresh, because the log cannot show which refresh caused one. Health reads SHALL be judged by cadence only. These checks change no shipped behaviour.

#### Scenario: Request logged after the window ends
- **WHEN** a first-page list request is logged after the timed window stopped and before the driver read its logs
- **THEN** it is not counted as a list start of that window and does not close the refresh that was still open

#### Scenario: Run read sent after the next refresh started
- **WHEN** a run read is sent after the next refresh's first list page, as the automatic follow-up of a run reconciliation can be
- **THEN** it is counted in the window's run-read count, which the artifact records
- **AND** it adds nothing to either refresh's per-refresh figures and is not lost with the final open refresh

#### Scenario: Run read before the window's first list start
- **WHEN** a run read is sent inside the window before the window's first list page, because the refreshes around it started before the window
- **THEN** it is counted in the window's run-read count and is not dropped

#### Scenario: Health read before its list page
- **WHEN** a refresh reads health before its first list page
- **THEN** that health read is not added to the previous refresh's traffic

#### Scenario: Inbox request across a window edge
- **WHEN** a standalone inbox request is sent before the window and answered inside it, and another is sent inside the window and answered after it
- **THEN** only the second is counted in the window's inbox split, by when it was sent
- **AND** per-refresh verdicts still rest on complete refreshes: a request of the refresh left open at the window's end changes no per-refresh verdict, like that refresh's list pages

#### Scenario: Reply-ordered attribution is caught
- **WHEN** attribution is changed to follow the order replies arrived
- **THEN** a unit test fails

### Requirement: The gate reports what it cannot compare

An artifact SHALL record how it attributed traffic and SHALL keep the wall-clock split of both inbox request forms. The gate SHALL compare the inbox form carried by the list read on its own as well as in the combined figure. A budget the gate cannot compare SHALL be reported as unverified and MUST NOT be reported as passed. That includes a per-refresh budget whose baseline and candidate figures do not rest on the same denominator.

#### Scenario: Older artifact that bucketed replies
- **WHEN** the baseline artifact was produced by a driver that attributed replies instead of requests
- **THEN** the gate names the difference and does not treat the two as equivalent complete samples

#### Scenario: Window with one list start
- **WHEN** an idle window holds a single list start, so no refresh completed inside it
- **THEN** the artifact still carries the wall-clock split of both inbox forms, and the form carried by the list read is still compared per list start
- **AND** no per-refresh budget is compared between that artifact's wall-clock figure and another artifact's complete refreshes

#### Scenario: Extra boundary request on the standalone form
- **WHEN** a baseline counts one more standalone inbox request than list starts, and a candidate adds one inbox window carried by the list read
- **THEN** the comparison of the form carried by the list read fails

#### Scenario: No comparable baseline
- **WHEN** the baseline, or all but one candidate, lacks the inbox split
- **THEN** the combined inbox budget is reported as unverified, the gate reports neither a pass nor a failed budget for it, and it exits unsuccessfully naming that state
- **AND** the comparisons that can be made still run

#### Scenario: Mixed denominators
- **WHEN** the baseline completed no refresh inside its window, so its list-page figure rests on wall-clock counts, and the candidates' figures rest on complete refreshes
- **THEN** the per-refresh budgets are reported as unverified and the gate exits unsuccessfully naming that state
- **AND** a candidate that reads eleven list pages per refresh is not passed against a wall-clock baseline figure of nineteen

#### Scenario: Per-refresh run-read budget
- **WHEN** the gate compares a baseline and candidates in the current artifact format
- **THEN** it shows each window's run-read count beside its list starts as a row that is not compared, and that row alone does not change the exit status
- **AND** it does not judge those counts as a budget

#### Scenario: Wrong denominator is caught
- **WHEN** the gate divides by health replies where it should divide by list starts
- **THEN** a unit test fails
