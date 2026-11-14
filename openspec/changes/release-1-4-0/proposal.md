# Agent Progress 1.4.0

## Why

Phone users need usable progress surfaces, and coordinators need a reliable view of work waiting for a person or another agent. A sibling's report currently invalidates a pending delegation without a useful coordinator notice. Completing the final tasks also requires a separate finish call. Combined handoff replay now performs a receipt lookup that grows with retained source history.

## What Changes

- Adapt panel, board, dependency map and controls for phone/touch use; opt each surface into mobile only after physical-device acceptance.
- Add a read-only, source-wide Needs you inbox. Count decision/review blockers; show remaining reported blockers separately as Also blocked.
- Show durable waiting delegation and refusal state without inventing assignment or progress. Preserve pending delegation across unrelated task reports, but refuse relevant changes and explain refusals to the coordinator.
- Allow explicit task changes atomically with coordinator finish.
- Add a transactionally installed receipt index on `(source, oid)` without changing replay meaning or the logical schema version.
- Update affected guides, guidance, compatibility evidence and generated distribution entries together.
- Fix native Windows legacy-upgrade startup and setup responsiveness before this release ships: cheap honest health, precise diagnostics and resumable short migration/inspection requests with visible Setup progress.

## Capabilities

### New Capabilities

- `phone-progress-surfaces`: accepted phone panel/page layouts and supported entry routes.
- `needs-you-inbox`: verified-source, cross-plan reported blockers and task navigation.
- `delegation-intent-visibility`: read-only pending/refused intent and coordinator notices.
- `atomic-plan-finish`: optional final task changes in one finish transaction.
- `handoff-receipt-index`: compatible indexed handoff replay lookup.
- `windows-setup-responsiveness`: nonblocking health and freshly validated, bounded, resumable managed migration with English/Russian phone-width progress.

### Modified Capabilities

- `subagent-task-reporting`: deliberately narrow delegation invalidation while retaining binding authority and after-binding reporting.

## Impact

Affected owners are the Store and run/receipt code, companion activation/tool guidance, service read projections, common UI controller/adapter/components, surface entries, map interaction/styles, package metadata, test fixtures and distribution scripts' existing inputs. Build SDK advances from 2.7.0 to 2.7.1 for the documented phone contract; plugin SDK 2.1.4 and the OpenChamber >=2.7.1 floor remain unchanged. `docs/contracts.md`, `docs/backend.md`, `docs/ui.md`, `docs/setup.md` and `docs/compatibility.md` remain the contract of record.

## IN / OUT / Must NOT have

IN: the capabilities above, English/Russian and accessibility coverage, isolated scripted-provider host verification, owner-operated physical-phone acceptance, and preparation of the accepted 1.4.0 distribution through existing release policy.

OUT: new model providers, notifications, inferred task state, additional polling loops, automatic preparation/resume turns, new permissions, replacement storage or UI frameworks, and unrelated cleanup.

The release MUST NOT bypass authentication, infer authority from an intent or phone device hint, claim mobile acceptance from a narrow desktop browser, use private host navigation, silently rebase a relevant conflict, erase receipts/history to accelerate lookup, or modify the owner's running host/profile. Host-drawn Work Status is conditional research only, not a build commitment. Publication remains a maintainer approval gate.

Windows setup adds no permission relaxation, cross-request ACL cache, synchronous admission on the health-serving event loop or automatic restoration of global capture. Short requests must preserve the full legacy ownership/removal and same-store/source contract; splitting the work is not permission to trust earlier security observations.
