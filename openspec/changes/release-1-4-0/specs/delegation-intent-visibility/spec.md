## ADDED Requirements

### Requirement: Stored waiting intent only

Affected tasks SHALL show a subdued next-sub-agent note only from current valid durable pending/reserved delegation. This projection SHALL be read-only, source-qualified and independent of task status, assignment authority and native activity. Missing or unverifiable intent SHALL produce no pending claim.

#### Scenario: Declare before dispatch
- **WHEN** the coordinator records an eligible durable declaration
- **THEN** affected tasks display the waiting note on the ordinary refresh even though plan revision has not advanced
- **AND** no task status, count or assignment changes because of the note

#### Scenario: Intent is consumed or invalidated
- **WHEN** binding, cancellation, a relevant change, structural change, close, cleanup or capture invalidation ends eligibility
- **THEN** the pending note clears and cannot survive through a stale cached detail
- **AND** a conflict is labelled as refusal rather than still waiting

### Requirement: Understandable coordinator refusal

The next eligible coordinator context SHALL expose a genuine delegation refusal with affected scope, reason and recovery guidance from retained disposition evidence. Guidance MUST NOT silently grant authority, dispatch again, re-declare or link on the coordinator's behalf.

#### Scenario: Binding refused after declaration
- **WHEN** a dispatch cannot bind because relevant plan state changed or identity evidence is insufficient
- **THEN** the coordinator sees that the declaration was not applied and how to inspect/re-declare or explicitly link
- **AND** the unbound child receives no assignment-derived report authority

#### Scenario: Restricted context or bounded evidence gap
- **WHEN** the tool is restricted or disposition evidence cannot be established within its bounds
- **THEN** no permission is expanded and no successful binding is asserted
- **AND** the limitation is explicit rather than an inferred absence of conflicts
