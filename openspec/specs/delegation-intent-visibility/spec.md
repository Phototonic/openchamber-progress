# delegation-intent-visibility Specification

## Purpose
Show eligible waiting delegations and identifiable refusal reasons without treating intent, dispatch or native activity as assignment authority or task progress.

## Requirements

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

### Requirement: Refusal guidance rests on validated receipt evidence

Before coordinator guidance infers from a delegation receipt that cleanup retired a waiting delegation, a pending or reserved receipt SHALL be checked as the per-plan reader checks it: pending names no dispatch, reserved names one, and both name at least one task. A receipt that fails MUST NOT produce a refusal; it SHALL make the guidance incomplete, as other unreadable evidence does. Other receipts SHALL be read as before. The check MUST NOT change a receipt, the store or any reply.

#### Scenario: Reserved without a dispatch
- **WHEN** a restored plan's latest delegation receipt says reserved and names no dispatch, and its intent is gone
- **THEN** coordinator guidance reports no `closed` refusal for it and is marked incomplete

#### Scenario: Pending with a dispatch
- **WHEN** a restored plan's latest delegation receipt says pending and names a dispatch
- **THEN** coordinator guidance reports no refusal for it and is marked incomplete

#### Scenario: Pending or reserved with no tasks
- **WHEN** a restored plan's latest delegation receipt says pending or reserved and declares no task, and its intent is gone
- **THEN** coordinator guidance reports no refusal for it and is marked incomplete

#### Scenario: Cancellation receipts are read as before
- **WHEN** a plan's latest delegation receipt is a cancellation, either the empty declaration that cancelled or the earlier declaration it retired, which keeps its tasks
- **THEN** coordinator guidance reads it as before this change: it reports no refusal for it and is not marked incomplete because of it

#### Scenario: Well-formed receipt after restore
- **WHEN** a restored plan's latest delegation receipt is pending without a dispatch, or reserved with one, names at least one task, its intent was retired by cleanup, and its declared tasks have not been verifiably recovered since
- **THEN** coordinator guidance reports the `closed` refusal as before

#### Scenario: Well-formed receipt whose tasks were recovered
- **WHEN** that same well-formed receipt is still the latest, and the plan's current assignment shows its declared tasks were explicitly linked since
- **THEN** coordinator guidance reports no refusal for it, as before this change

#### Scenario: Both readers agree
- **WHEN** the per-plan reader rejects a pending or reserved receipt because its dispatch disagrees with its state
- **THEN** coordinator guidance does not present that same receipt as complete evidence
