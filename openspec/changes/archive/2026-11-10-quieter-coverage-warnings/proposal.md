# Quieter sub-agent coverage warnings

## Why

A single past recording failure currently leaves `capture.loss` set indefinitely. Every later reading can repeat a warning even though nothing has recently gone wrong. The flag also covers bounded admission, incomplete observation evidence and discarded claims, so attributing every gap to full or unavailable storage is inaccurate.

Permanent incompleteness must remain disclosed, but it should be separate from a recent issue that deserves attention.

## What Changes

- Record the backend detection time of the latest recording gap and a race-safe dismissal checkpoint in the run store.
- Warn for an undismissed gap younger than 24 hours. Keep older and dismissed gaps in the existing Partial disclosure, with their last known date.
- Allow an explicit dismissal from the rail or board. Save it for the whole store; quiet the initiating view on acknowledgement and other open views on their next successful ordinary refresh.
- Migrate existing loss flags without inventing dates or treating them as recent.
- Preserve permanent `capture-loss` coverage qualification, retained counts and the separation between run facts, authored claims and task progress.
- Update the authoritative documentation and regenerate the affected tracked runtime entries in the implementation change.

### Must NOT have

No general dismissible-notes framework, loss history log, local preference store, cross-frame messaging channel, new poller, native session/transcript access, task mutation, loss-flag clearing, destructive downgrade, package version bump or unrelated output regeneration. The preceding muted Partial badge/disclosure change is a prerequisite, not work included here. This change is a separate stacked pull request; the pair is not released separately.

## Capabilities

### New Capabilities

- `subagent-loss-notices`: durable recording-gap metadata, safe acknowledgement, compatibility and surface-specific attention while retaining incomplete-coverage disclosure.

### Modified Capabilities

None in OpenSpec: this is the first change and there are no canonical specs yet. The existing contracts in `docs/contracts.md`, `docs/backend.md`, `docs/ui.md`, `docs/compatibility.md` and `docs/setup.md` remain authoritative and must be amended alongside implementation. This change does not import unrelated existing capabilities into OpenSpec.

## Impact

Storage and DTO ownership remain in `shared/subagent-runs.ts` and `shared/store.ts`; the authenticated service route remains in `service/server.ts`. Guest validation, transport, visit lifecycle and rendering remain in the existing shared UI owners. Backend migration/HTTP tests and the existing sub-agent browser harness provide the acceptance boundaries. All three guest bundles and affected backend outputs must be rebuilt through repository scripts.
