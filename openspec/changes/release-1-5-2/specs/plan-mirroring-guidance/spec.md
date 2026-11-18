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

### Requirement: The companion's system prompt section stays identical across requests

The companion's section of the system prompt SHALL contain only text that does not change within a session, and SHALL be byte-identical on every request where it is present. The one-request hint, the sub-agent resume capsule and the delegation refusal note SHALL be added after the content of the latest message, in a carrier valid for its role, and SHALL stay there on later requests, with their text and eligibility unchanged. They MUST NOT be dropped; the stored conversation MUST NOT change.

#### Scenario: A hint is due
- **WHEN** a dispatch or a plan-file write makes the one-request hint due and the next request is built
- **THEN** the system section is identical to the previous request's, and the hint is added after the latest message's content

#### Scenario: Continuation after a plan-file write
- **WHEN** a plan-file write succeeds and the next request continues the tool call, so its latest message is a tool message
- **THEN** the system section is unchanged, and the hint is appended to the output of that message's last tool result, so the request stays valid for the provider

#### Scenario: Later requests keep earlier notes
- **WHEN** a request carried a note and the next request is built from the same stored history with new messages after it
- **THEN** the next request repeats that message with the same note in the same place, so its messages begin with the previous request's messages byte for byte, and the stored conversation does not contain the note

#### Scenario: No valid carrier
- **WHEN** a note is due and the latest message has no valid carrier, such as an assistant message or the Code Mode `execute` wrapper's result
- **THEN** nothing is added on that request, and the note is added on the next request whose latest message has a valid carrier

#### Scenario: A sub-agent's plan moved on
- **WHEN** a sub-agent session sends two requests and the plan's revision changed between them, or the capsule lookup timed out for the second
- **THEN** the system section is identical on both requests; after a revision change the second request carries the new capsule after its latest message, and after a timeout it adds nothing, while the earlier capsule stays where it was

#### Scenario: A refusal appears and clears
- **WHEN** a delegation refusal note applies to one request and not to a later one
- **THEN** the system section is identical on both, the note stays where it was delivered, and one fixed line saying the refusal no longer applies is added after the later request's latest message

#### Scenario: Section removed
- **WHEN** capture is off, the report tool is unavailable or the source is unverified
- **THEN** the section is absent as before, every note the companion added is removed from the request, and no new note is added

