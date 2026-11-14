## ADDED Requirements

### Requirement: Optional atomic final task changes

Coordinator finish SHALL optionally accept the same 1–50 unique explicit task changes and validation limits as change. Changes and finish SHALL commit atomically at the expected revision. Successful finished outcome SHALL still require nonzero actionable work with none remaining after the changes. Omitted changes SHALL retain existing finish behavior.

#### Scenario: Finish with last task changes
- **WHEN** the coordinator supplies valid changes resolving the remaining actionable work and outcome finished
- **THEN** one ordinary revision records the explicit task changes, direct contribution and closed lifecycle
- **AND** structural revision does not advance

#### Scenario: Any component refuses
- **WHEN** a task is a group/unknown, validation or authority fails, the revision conflicts, actionable work remains, or commit fails
- **THEN** neither task changes nor finish is newly committed
- **AND** the existing useful validation/conflict guidance remains, including the group/unknown-ID hint

#### Scenario: Cancelled or failed outcome
- **WHEN** the coordinator supplies valid explicit changes with cancelled or failed
- **THEN** changes and the requested outcome commit together under existing close/blocker-history rules
- **AND** no implicit done status is assigned to other tasks

### Requirement: Full-input replay and old writer behavior

Finish replay SHALL bind complete semantic input and actual caller identity. Identical accepted retries SHALL return the original receipt without another revision; altered operation reuse SHALL refuse. Children SHALL remain unable to finish. Older writers SHALL remain usable for existing operations and MUST NOT falsely accept unsupported combined input.

#### Scenario: Identical or altered retry
- **WHEN** an accepted combined finish is retried identically or with changed/omitted changes under the same operation ID
- **THEN** the identical retry returns its prior result and altered reuse refuses without new writes

#### Scenario: Older or restricted caller
- **WHEN** an older report tool receives the new optional field or an assigned child attempts finish
- **THEN** unsupported input or authority is refused rather than field-stripped into another operation
