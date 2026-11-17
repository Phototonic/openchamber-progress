## ADDED Requirements

### Requirement: Guidance explains a report refused after the person archived or deleted the plan

The skill SHALL state in one sentence that a write refused as `closed` on a plan that was in progress, or as `not-found` on a plan the agent started, means the person archived or deleted that plan, and that the agent stops reporting to it, does not retry and does not recreate it under another identifier unless the person specifically asks for it. The guidance SHALL stay advisory and MUST NOT change any tool input, validation, reply or size limit.

#### Scenario: Archived while in progress
- **WHEN** an agent holding only the companion's text receives `closed` for a change to a plan it was reporting, and then `closed` again for a reopen
- **THEN** the guidance leads it to stop reporting to that plan and continue its work, without retrying and without starting a replacement plan

#### Scenario: Deleted
- **WHEN** an agent receives `not-found` for a plan it started earlier
- **THEN** the guidance leads it not to start the same plan again under a new identifier

#### Scenario: The person asks for tracking again
- **WHEN** the person specifically asks the agent to track that work again after deleting or archiving its plan
- **THEN** the guidance allows the agent to start a new plan under a new identifier

#### Scenario: Ordinary closed plan
- **WHEN** an agent's own plan is finished and it has real further work
- **THEN** the existing reopen guidance still applies and is not replaced by this sentence

#### Scenario: Description limits
- **WHEN** the companion's texts are built
- **THEN** the tool description stays within its existing total limit, with the checklist and start example inside its first part
