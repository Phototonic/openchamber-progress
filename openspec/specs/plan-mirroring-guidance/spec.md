# plan-mirroring-guidance Specification

## Purpose
Tell agents when to mirror their plan into Agent Progress and how to report it, through guidance that survives truncation and providers that drop plugin system text, and keep any hint advisory and honest.

## Requirements

### Requirement: Guidance leads with a short checklist of when to report

Every guidance surface the companion provides SHALL open with the same short positive checklist: start the mirror when a plan is ready for execution, with its real tasks and prerequisites; declare or link a sub-agent's tasks before dispatching it; mark a task as working when work on it starts; finish, cancel or fail the plan explicitly. Prohibitions and operation detail SHALL follow the checklist.

#### Scenario: Description opening
- **WHEN** an agent is shown the report tool
- **THEN** the description opens with the four checklist steps, each naming the operation it uses
- **AND** no prohibition precedes them

#### Scenario: Other surfaces
- **WHEN** the companion adds its section to a session context, or an agent loads the skill
- **THEN** that text opens with the same checklist

#### Scenario: Skill listing
- **WHEN** a host lists skills by name and one-line description only
- **THEN** the line says when to load the skill: on writing, receiving or coordinating a plan, and before dispatching sub-agents

### Requirement: The tool description survives truncation

The report tool's description and the context section SHALL each be shorter than in the previous release. The checklist and one valid start example SHALL fit inside the smallest description limit recorded for a supported client. Detail removed from the description SHALL remain available in the skill, which the description SHALL name.

#### Scenario: A client cuts long descriptions
- **WHEN** a client truncates the description at the smallest limit recorded for a supported client
- **THEN** the whole checklist and one valid start example with a prerequisite remain inside the kept part

#### Scenario: Detail stays reachable
- **WHEN** an agent needs delegation, staging or handoff rules that left the description
- **THEN** the skill states them and the description says where to find them

### Requirement: Guidance reaches the agent without custom instructions

With the companion installed and recording on, an agent whose session exposes the report tool SHALL receive the checklist and conditional hints from the companion alone. No project instruction file, user-authored skill, agent prompt or orchestrator prompt SHALL be needed. A session whose report tool is hidden or restricted SHALL receive neither.

#### Scenario: No instructions mention Agent Progress
- **WHEN** the session's instruction files, skills and agent prompt never mention Agent Progress
- **THEN** the checklist and the hints are still delivered

#### Scenario: Report tool hidden or recording off
- **WHEN** the session's effective tools exclude the report tool, the source is unverified or recording is off
- **THEN** no section and no note is added and tool results are unchanged

### Requirement: Delivery does not depend on forwarded system text

Delivery MUST NOT depend on the model provider forwarding text that a plugin adds to the system prompt. The checklist SHALL travel in the tool description, and a conditional hint SHALL also travel as a short fixed note appended to the result of an observed call. The existing context section SHALL still be added for providers that forward it.

#### Scenario: Provider forwards only tool definitions and tool results
- **WHEN** a coordinator's provider rebuilds the system prompt and shows tools under a host-prefixed name
- **AND** the coordinator completes a sub-agent dispatch while recording is on
- **THEN** the checklist is in the report tool's description as the model sees it
- **AND** the dispatch result ends with a note asking it to start a mirror if its planned work has none, and to declare or link tasks before the next dispatch
- **AND** the note names the report tool so that it is recognisable under a host prefix

#### Scenario: Plan write
- **WHEN** that coordinator writes or edits a recognised plan document
- **THEN** the result of that call ends with the plan note

#### Scenario: A delegated planner wrote the plan
- **WHEN** a sub-agent writes a recognised plan document and its verified direct parent next completes a dispatch, plan write or tracker update
- **THEN** that result carries the plan note for the parent once
- **AND** for a dispatch the parent was waiting on, this is the result that returns the planner

#### Scenario: Provider forwards system text
- **WHEN** the provider forwards plugin system text
- **THEN** the context section and its hint are delivered as before
- **AND** each of the two carriers delivers one observation at most once

### Requirement: Plan documents are recognised where planning workflows write them

A successful single-file write or edit SHALL raise the plan hint when its path is a Markdown file that is named `plan`, lies under a `plans` or `.plans` folder, or is the `tasks.md` or `proposal.md` of one spec change directly under `openspec/changes/`. Files written by a shell command or an unrecognised tool SHALL NOT be observed.

#### Scenario: Spec-change task list
- **WHEN** a session writes `openspec/changes/example/tasks.md` in its own directory
- **THEN** the plan hint is raised for it and, when verified, for its direct parent

#### Scenario: Archived or auxiliary spec files
- **WHEN** a session edits a file under `openspec/changes/archive/`, a spec delta or a design note
- **THEN** no plan hint is raised

#### Scenario: Shell-written plan
- **WHEN** a plan file is created by a shell command
- **THEN** nothing is observed, and the checklist and the dispatch note remain the only prompts

### Requirement: Plan paths in other worktrees of the same project are accepted

A plan-shaped path SHALL be accepted inside the writing session's directory, or inside another directory that the host lists as the root or a worktree of that session's own project. Recognition SHALL use the path and host-reported project facts only; the companion MUST NOT read the file, its folder or repository metadata to decide.

#### Scenario: Plan in a sibling worktree
- **WHEN** a session writes a plan file under a `plans` folder, by absolute path, into a directory the host lists as another worktree of the session's project
- **THEN** the plan hint is raised

#### Scenario: Path outside the project
- **WHEN** the path resolves outside the session directory and outside every host-listed worktree of its project, or the host cannot list them
- **THEN** no hint is raised

#### Scenario: Parent in another worktree
- **WHEN** the writer's verified direct parent belongs to the same project and works in another host-listed worktree of it
- **THEN** that parent is flagged once, and no other ancestor or sibling is

### Requirement: Hints stay advisory and honest

A checklist, section or note MUST NOT send a report, start a plan, assign or link a task, or state or imply that work started, was reviewed, was approved or finished. Observation and delivery SHALL perform no plan lookup, no document read and no store write. Only a deliberate report changes recorded progress.

#### Scenario: Hint without a report
- **WHEN** sections and notes are delivered and the agent sends no report
- **THEN** the store holds no new plan, revision, receipt or contribution

#### Scenario: A user adds their own reminder
- **WHEN** a user's own instructions also tell the agent to mirror plans
- **THEN** nothing conflicts: an identical repeated start returns the original receipt, a different start for a plan that already exists is refused with the current revision, and the checklist tells the agent to read first and not to repeat state that is already current

### Requirement: Result notes leave the original call intact

A note SHALL be fixed text chosen by the kind of observation, with no path, title, prompt, worker output or identifier. It SHALL be added only to a completed call that qualified under the existing metadata rules, after that call's original output, and MUST leave the output and structured result intact. A failed, cancelled or partial call MUST NOT be changed.

#### Scenario: Original result preserved
- **WHEN** a note is added to a dispatch result
- **THEN** the returned child session, status and output are unchanged for the model and for run recording
- **AND** the note follows them

#### Scenario: Failed or unrecognised call
- **WHEN** a call fails, is cancelled, is partial or does not match the recognised metadata
- **THEN** its result is not changed

#### Scenario: Several qualifying calls in one step
- **WHEN** several qualifying calls of one session complete in the same model step
- **THEN** at most one note is added for that step

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

The companion's section of the system prompt SHALL contain only text that does not change within a session, and SHALL be byte-identical on every request where it is present. The one-request hint, the sub-agent resume capsule and the delegation refusal note SHALL be added after the content of the latest message, in a carrier valid for its role, with their text unchanged. A due note MUST NOT be dropped for lack of a carrier, and the stored conversation MUST NOT change.

#### Scenario: A hint is due
- **WHEN** a dispatch or a plan-file write makes the one-request hint due and the next request is built
- **THEN** the system section is identical to the previous request's, and the hint is added after the latest message's content

#### Scenario: Continuation after a plan-file write
- **WHEN** a plan-file write succeeds and the next request continues the tool call, so its latest message is a tool message
- **THEN** the system section is unchanged, and the hint is appended to the output of that message's last tool result, so the request stays valid for the provider

#### Scenario: No valid carrier
- **WHEN** a note is due and the latest message has no valid carrier, such as an assistant message or the Code Mode `execute` wrapper's result
- **THEN** nothing is added on that request, and the note is added on the next request whose latest message has a valid carrier

### Requirement: Delivered context notes stay in place on later requests

Delivered notes SHALL replay unchanged on their remembered carriers, except for confirmed loss of child assignments as specified below. A current capsule or refusal SHALL be delivered again only if its text changes or its last carrier is absent. A delivered refusal that clears on a complete read SHALL receive the existing fixed cleared line. Removing the system section MUST remove every added note from that request.

#### Scenario: Later requests keep earlier notes
- **WHEN** a later request extends the same stored history and no child assignment note is being cleared
- **THEN** the remembered notes stay on their carriers, so the messages begin with the previous request's messages byte for byte and the stored conversation contains none of those additions

#### Scenario: A sub-agent's plan moved on
- **WHEN** a sub-agent session sends two requests and an eligible plan's revision changed between them, or the capsule lookup timed out for the second
- **THEN** the system section is identical on both requests; after a revision change the second request carries the new capsule after its latest message, and after a timeout it adds nothing, while the earlier capsule stays where it was

#### Scenario: A refusal appears and clears
- **WHEN** a delegation refusal note applies to one request and not to a later one
- **THEN** the system section is identical on both, the note stays where it was delivered, and after a successful, complete read with no refusal the fixed cleared line is added after the later request's latest message; a failed read adds nothing

#### Scenario: Standing note after its carrier is gone
- **WHEN** a still-current capsule or refusal note was delivered and a later request no longer holds that carrier, after compaction, a reverted message or an evicted carrier, and the text is unchanged
- **THEN** the current capsule or refusal is delivered again after that request's latest message

#### Scenario: Reused tool call identifier
- **WHEN** a later turn's tool result reuses the call identifier of a tool result that carried a note
- **THEN** the newer tool result does not receive the earlier note

#### Scenario: Section removed
- **WHEN** any path removes the section, such as capture off, the report tool unavailable, the source unverified or a failure in the hook
- **THEN** the section is absent as before, every note the companion added is removed from the request, and no new note is added

### Requirement: A child stops receiving obsolete assignment details on confirmed loss

When a successful, complete and unabridged lookup for the same verified child, store and source finds no eligible assignments, the companion SHALL retire that child's remembered assignment capsules. If any would be replayed, it SHALL replace them with one fixed neutral line in place of the most recent one present. It MUST NOT change other notes, original message content, the stored conversation or reporting authority.

#### Scenario: The last assignment is unlinked or its plan is deleted
- **WHEN** a later eligible request still contains a carrier for a delivered child capsule and confirms there are no assignments left
- **THEN** none of the earlier child capsule versions are replayed, including any delivered after compaction; the sole replacement is `Agent Progress note: the earlier assignment note is no longer current.`
- **AND** unrelated notes on the same message survive in order, the system section is unchanged and subsequent empty reads do not add more lines

#### Scenario: Absence is not established
- **WHEN** no lookup took place, it failed, its identity did not match, or discovery was incomplete or omitted candidates
- **THEN** no capsule is retired and no replacement is produced on that evidence; existing eligibility and section-removal rules still apply

#### Scenario: Previously delivered text is no longer in the request
- **WHEN** the complete empty lookup occurs while none of the obsolete capsule carriers is present, or no capsule was ever delivered
- **THEN** no line is introduced, and bringing an old carrier back does not bring its retired assignment text back

#### Scenario: The child receives another assignment
- **WHEN** a later read finds eligible assignments after the earlier capsules were cleared
- **THEN** the current capsule is delivered normally, without restoring the retired versions
