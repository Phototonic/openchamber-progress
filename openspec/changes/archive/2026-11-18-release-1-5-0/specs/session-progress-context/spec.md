## MODIFIED Requirements

### Requirement: Explicit empty and multiple-plan handling

The action SHALL reuse existing panel plan selection within the validated source/session result, including a valid saved choice and the normal automatic selection rule. Multiple plans SHALL remain individually selectable and visibly scoped, with the picker stating the shown plan's position among them. Failed or incomplete reads SHALL NOT be presented as an authoritative empty or complete result.

#### Scenario: Multiple reported plans
- **WHEN** the target has several eligible plans
- **THEN** the existing picker exposes them and states the shown plan's position, without a separate chosen-or-automatic note
- **AND** no combined synthetic plan or cross-source fallback is created

#### Scenario: No plans or incomplete read
- **WHEN** a complete validated result is empty
- **THEN** the panel explains that the session has no plan yet
- **AND** a failed read instead explains itself, and a capped read marks its counts as possibly incomplete, rather than claiming no plans
