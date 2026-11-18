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
