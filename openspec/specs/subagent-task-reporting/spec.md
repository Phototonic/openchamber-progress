# subagent-task-reporting Specification

## Purpose
Let verified, assigned sub-agents report their own tasks after dispatch binding, including an optional atomic final task report and handoff claim, while preserving task authority, direct attribution, replay safety and coordinator ownership of plan structure.

## Requirements

### Requirement: Deliberate delegation before assigned work

Companion guidance SHALL direct coordinators to declare known plan/task assignments before supported child dispatches and to provide the corresponding reporting context. Declaration, dispatch and native activity MUST NOT set task status or grant child authority before verified binding. Existing explicit linking and honestly attributed relay fallbacks SHALL remain available without relaxing host tool restrictions.

#### Scenario: Declared task dispatch
- **WHEN** a coordinator declares existing task IDs at the expected revision and a supported dispatch yields verified matching child identity
- **THEN** the existing binding mechanism records the assignment and provenance
- **AND** task status, counts and reported progress remain unchanged until a deliberate report

#### Scenario: Binding conflicts or cannot be verified
- **WHEN** the plan changes before binding or child/source/ancestry evidence is insufficient
- **THEN** the existing visible conflict or unconfirmed disposition is retained
- **AND** the intent is not silently rebased or transferred to another dispatch

### Requirement: Current bounded assigned-child brief

A permitted child SHALL receive a bounded assignment-specific brief on an eligible context after its assignment is verifiable. The brief SHALL identify only current authorized plan/task scope, require current reads before mutation, and explain working, blocked and done reporting plus the coordinator-only structure/finish boundary. Guidance SHALL remain advisory and SHALL NOT cause a report merely because it is delivered.

#### Scenario: Eligible assigned child
- **WHEN** a child with the report tool receives a context after verified binding to an active visible plan
- **THEN** it receives concrete plan and assigned task IDs and instructions to report its own meaningful changes
- **AND** last-known revision metadata is not represented as a fresh mutation fence

#### Scenario: Restricted or unassigned child
- **WHEN** the tool is unavailable, ancestry is unknown, capture is disabled, or the assignment is absent/removed
- **THEN** no assigned reporting permission is asserted and no tool policy is changed
- **AND** a stale brief cannot authorize a later write

#### Scenario: Brief exceeds discovery or output bounds
- **WHEN** bounded discovery or rendering cannot provide all eligible scope
- **THEN** the brief explicitly qualifies incomplete scope or declines it
- **AND** no identifier is truncated and omitted scope is not represented as nonexistent

### Requirement: Honest after-binding participation

Direct reporting SHALL be supported after binding without automatic preparation turns, resumption or backfilled progress. The documentation SHALL disclose that a first execution may complete before assignment becomes available and that model participation remains best effort.

#### Scenario: Child finishes before assignment is known
- **WHEN** a new child's first execution ends before the verified assignment can be delivered
- **THEN** the companion does not fabricate a working/done report or schedule another execution
- **AND** the absence of direct task reports remains visible as absence, not completion

#### Scenario: Two children report after binding
- **WHEN** two real delegated children subsequently receive eligible contexts with separate verified tasks
- **THEN** each can report working and then done or blocked for its own task without coordinator relay calls
- **AND** rail and map show ordinary direct-child report attribution

### Requirement: Optional explicit atomic handoff task update

Handoff SHALL optionally accept one plan's expected revision and 1–50 unique explicit task changes using existing status/blocker semantics. All targets SHALL belong to the actual verified child's current assignment. Success SHALL atomically record the claim, changes and replay receipt, return both receipts, and attribute task reports directly to that child. Claim outcome MUST NOT implicitly choose task status or finish a plan.

#### Scenario: Successful combined final report
- **WHEN** a verified assigned child submits a valid handoff with an explicit task update at the current revision
- **THEN** both requested components commit and the plan advances by one ordinary task-change revision
- **AND** the response includes the accepted handoff and its task receipt without coordinator acceptance or finish being inferred

#### Scenario: Bare claim remains independent
- **WHEN** the child sends a handoff without a task update, including outcome done
- **THEN** the existing claim-only behavior remains and no task status, task count or plan revision changes

#### Scenario: Partial outcome has an explicit task status
- **WHEN** a child reports a partial outcome with an explicit blocked task and safe blocker details
- **THEN** the task is blocked because of that explicit update, not because of the claim outcome
- **AND** reason and next action use the existing blocker contract, with unknown parts left unknown

### Requirement: Preserved task authority and visible conflicts

Combined reports SHALL enforce the same task authority, capture permissions, lifecycle and expected-revision rules as ordinary child changes, alongside existing claim eligibility. A refused operation MUST NOT commit a new requested claim or its requested task changes. Children MUST NOT change siblings, unassigned tasks, groups, structure or plan lifecycle through this operation.

#### Scenario: Unassigned or mixed-authority batch
- **WHEN** any requested task is unknown, a group, unassigned or assigned to another child
- **THEN** the entire requested combined operation is refused with the applicable clear validation/assignment error
- **AND** no allowed subset is committed

#### Scenario: Parent and child compete at one revision
- **WHEN** the parent and child submit mutations against the same current revision
- **THEN** at most one succeeds and the other receives a visible revision conflict with the current revision
- **AND** there is no lost update, automatic rebase or partial new handoff claim

#### Scenario: Claim failure or interrupted commit
- **WHEN** claim eligibility fails, storage commit fails, or reporting authority retires while permission is held
- **THEN** neither requested component is newly committed
- **AND** independent correction of an older invalid claim association cannot publish the rejected task update

### Requirement: Durable combined replay and legacy compatibility

Combined replay SHALL bind the complete semantic input and actual caller identity. Identical accepted retries SHALL return the original combined result without duplicate progress or claims; altered operation reuse SHALL refuse. Existing bare handoff compatibility, execution association and claim retention fences SHALL remain. Missing combined replay evidence MUST NOT be reconstructed into another task mutation.

#### Scenario: Identical and altered retries
- **WHEN** a successful combined report is retried identically or with altered task data under the same operation identity
- **THEN** the identical retry returns its original result without another revision
- **AND** the altered retry refuses, including attempts to upgrade a previously accepted bare handoff

#### Scenario: Pruning or mixed writer loses evidence
- **WHEN** run pruning, plan cleanup or a legacy writer leaves insufficient combined receipt evidence
- **THEN** retry is explicitly unavailable or conflicting rather than reapplying task changes or recreating history
- **AND** ordinary retained progress remains readable without down-migration

#### Scenario: Older report tool
- **WHEN** a companion does not support the optional task update
- **THEN** the unsupported input is refused rather than reported as combined success
- **AND** any fallback to separate reporting is deliberate after inspecting current state, not an automatic field-stripping retry
