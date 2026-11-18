## ADDED Requirements

### Requirement: Guidance clears a dependency block against the plan's current prerequisites

The skill, the tool description and the inline guidance SHALL tell an agent that blocked a task because work moved back to its prerequisites to read the current plan before a handoff, and to unblock that task once every prerequisite it still has is done. A prerequisite the plan no longer lists MUST NOT keep it blocked; a skipped prerequisite that is still listed SHALL count as unfinished. The guidance SHALL stay advisory and MUST NOT change any tool input, validation, reply or size limit.

#### Scenario: A revision removes one of two prerequisites
- **WHEN** an agent holding only the companion's text blocked a task on prerequisites A and B, an approved plan revision removes B as a prerequisite, and A finishes
- **THEN** the guidance leads it to set the task back to working or pending without waiting for B

#### Scenario: A listed prerequisite was skipped
- **WHEN** a prerequisite the task still lists is skipped instead of done
- **THEN** the guidance does not lead the agent to clear the block for that reason

#### Scenario: Before a handoff
- **WHEN** the agent is about to hand off with a task it blocked this way
- **THEN** the guidance leads it to read the current plan first and to clear the block if no listed prerequisite is unfinished

#### Scenario: Another kind of blocker
- **WHEN** a task is blocked with a decision, review, external or other blocker
- **THEN** the guidance leaves that task and its blocker as they are

#### Scenario: Description limits
- **WHEN** the companion's texts are built
- **THEN** the tool description stays within its existing total limit, with the checklist and start example inside its first part
