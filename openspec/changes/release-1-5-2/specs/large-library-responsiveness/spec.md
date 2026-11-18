## ADDED Requirements

### Requirement: Idle traffic is attributed to the refresh that caused it

The release gate's idle-traffic comparison SHALL count only requests sent inside the timed window and SHALL keep each one with the refresh that sent it. A request a refresh causes after the next refresh started SHALL be reported apart from the per-refresh figures and still compared; it MUST NOT be charged to the newer refresh or dropped. Health reads SHALL be judged by cadence and kept out of per-refresh traffic. These checks change no shipped behaviour.

#### Scenario: Request logged after the window ends
- **WHEN** a first-page list request is logged after the timed window stopped and before the driver read its logs
- **THEN** it is not counted as a list start of that window and does not close the refresh that was still open

#### Scenario: Follow-up sent after the next refresh started
- **WHEN** a refresh causes a run read that is sent after the next refresh's first list page
- **THEN** that read is reported outside the per-refresh buckets, where the gate still compares it with the baseline
- **AND** it is not charged to the newer refresh and not lost with the final open bucket

#### Scenario: Health read before its list page
- **WHEN** a refresh reads health before its first list page
- **THEN** that health read is not added to the previous refresh's traffic

#### Scenario: Reply-ordered attribution is caught
- **WHEN** attribution is changed to follow the order replies arrived
- **THEN** a unit test fails

### Requirement: The gate reports what it cannot compare

An artifact SHALL record how it attributed traffic and SHALL keep the wall-clock split of both inbox request forms. The gate SHALL compare the inbox form carried by the list read on its own as well as in the combined figure. A budget the gate cannot compare SHALL be reported as unverified and MUST NOT be reported as passed.

#### Scenario: Older artifact that bucketed replies
- **WHEN** the baseline artifact was produced by a driver that attributed replies instead of requests
- **THEN** the gate names the difference and does not treat the two as equivalent complete samples

#### Scenario: Window with one list start
- **WHEN** an idle window holds a single list start, so no refresh completed inside it
- **THEN** the artifact still carries the wall-clock split of both inbox forms for the comparison

#### Scenario: Extra boundary reply on the standalone form
- **WHEN** a baseline counts one more standalone inbox reply than list starts, and a candidate adds one inbox window carried by the list read
- **THEN** the comparison of the form carried by the list read fails

#### Scenario: No comparable baseline
- **WHEN** the baseline, or all but one candidate, lacks the inbox split
- **THEN** the combined inbox budget is reported as unverified, the gate reports neither a pass nor a failed budget for it, and it exits unsuccessfully naming that state
- **AND** the comparisons that can be made still run

#### Scenario: Wrong denominator is caught
- **WHEN** the gate divides by health replies where it should divide by list starts
- **THEN** a unit test fails
