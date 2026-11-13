# report-tool-presentation Specification

## Purpose
Identify Agent Progress calls in chat without turning a request or receipt into proof of effective progress or verified completion.

## Requirements

### Requirement: Declarative report identification

On a supporting host, the enabled and approved extension SHALL contribute a recognizable checklist icon and the neutral title **Agent progress report** for the exact native tool name `agent_progress_report`. The contribution SHALL add no permission, executable presentation surface or reporting authority.

#### Scenario: Report operations in a real chat
- **WHEN** actual `start`, `change`, `revise` and `finish` calls appear in an isolated OpenChamber 2.7.1 chat
- **THEN** their rows use the report title and checklist icon
- **AND** the operation's output remains available as literal text
- **AND** a finish request is not labelled verified completion

#### Scenario: Different or unavailable tool
- **WHEN** the host renders a different tool, or the extension is inactive
- **THEN** this contribution does not supply its presentation or enable reporting

### Requirement: Truthful fallback instead of an outcome subtitle

Because existing receipts cannot reliably identify effective changes or partial ancillary outcomes, the contribution SHALL omit an extension-authored subtitle and dynamic success title. It MUST NOT describe submitted inputs, a host-completed execution, a revision or a `changed` list as proof that requested effects occurred. The documented result SHALL explicitly identify the richer outcome-summary feature as no-go under this contract.

#### Scenario: Accepted call with no new task-status effect
- **WHEN** a task is reported with its already-recorded status, or an identical operation is replayed
- **THEN** the row makes no new-effect or completion claim
- **AND** documentation states that the receipt alone cannot distinguish all such calls from effective changes
- **AND** no new effect flag, duplicate receipt or computed result cache is introduced

#### Scenario: Checklist accepted but document capture denied
- **WHEN** a valid report commits while optional document capture is denied
- **THEN** the title and icon do not assert that capture succeeded or that all requested effects were confirmed
- **AND** existing output and report semantics remain unchanged

#### Scenario: Staging, read or child handoff
- **WHEN** the same tool returns a staged receipt, read result or child claim, including a partial claim without a plan input
- **THEN** the neutral tool identity does not invent a plan, committed progress, acceptance or completion

### Requirement: Preserve results and failures

The contribution SHALL use the host's `text` output layout, preserve access to the complete tool response and leave native error handling intact. It SHALL NOT replace errors with success wording or treat absence of an error field as proof of task effects. The report tool's input, output, metadata and receipt contract SHALL remain unchanged.

#### Scenario: Rejected report beside an accepted report
- **WHEN** a stale-revision report returns `{error: "conflict", rev: ...}` beside an accepted report
- **THEN** opening their rows exposes the error and receipt respectively without selective field removal
- **AND** the extension title asserts success for neither call
- **AND** a completed host execution carrying JSON error data is not described as a successful report

#### Scenario: Native schema rejection
- **WHEN** OpenCode rejects a malformed invocation before the plugin executes
- **THEN** the native error remains visible and the contribution does not claim that a report was accepted

### Requirement: Additive compatibility

The change SHALL retain the existing OpenChamber `>=2.7.1` floor, dependency pins, permissions and unrelated contributions. A host without an applied presentation rule SHALL retain its existing tool rendering rather than require a new extension runtime. Older-parser tolerance SHALL NOT be described as installation support below the declared floor.

#### Scenario: Packaged candidate
- **WHEN** the current extension is assembled for folder or ZIP delivery
- **THEN** its manifest preserves the tools entry and existing contributions without rebuilding unchanged runtime entries

#### Scenario: Older host
- **WHEN** a host below the declared floor attempts to install the candidate
- **THEN** the existing version gate remains in force
- **AND** the change neither lowers that floor nor promises rich rendering on the older host
