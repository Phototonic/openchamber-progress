# Quiet plans and explicit user cancellation

## Why

Plans can remain active long after reporting stops. Their presence crowds plan selection, but silence does not establish completion, failure or abandonment. People need a factual way to narrow the view and a separate, deliberate way to close work they no longer intend to continue.

## What Changes

- Label active plans with no stored report for at least seven days using factual elapsed-day copy.
- Offer a remembered filter, enabled initially, on the rail and board, without changing stored plans or inferring outcomes.
- Add **Finish as cancelled** to the selected plan's existing More menu, with confirmation, user attribution and retained history and unfinished tasks.
- Keep reopening on the existing coordinator `revise` / staged `commit` path with `reopen:true`.
- Document the new narrow user-write authority separately from agent reporting and cleanup.

## Capabilities

### New Capabilities

None: extend the existing surface, device-preference and lifecycle contracts.

### Modified Capabilities

- `progress-surface-hierarchy`: factual quiet labels, filtered rail/board choices and the cancellation menu entry.
- `device-remembered-view-state`: permit and safely persist the additional view preference.
- `atomic-plan-finish`: add a confirmed user-cancellation path without widening agent finish authority.

## Scope

**IN:** active-plan report-age presentation; rail and board filtering, including board search; device persistence; single-plan user cancellation; visible historical user attribution; existing reopen semantics; English, Russian and Simplified Chinese; affected guides and focused behavioural checks.

### Must NOT have

- Automatic finish, cancel, archive, deletion or task changes based on age.
- Labels describing work as abandoned, stale, done or failed because of silence.
- Per-task user interaction, bulk cancellation, a new UI reopen workflow or stopping running agents.
- Changes to the plan-view switch or its document-navigation work.
- Changes to Work Status selection, Needs you membership, composer discovery, agent report inputs or live activity inference.
- Configurable thresholds, new settings frameworks, registries, rollout flags, dependencies, polling loops, migrations or background backfills.
- Generated-output commits on development branches, a version bump, live-profile tests or model calls.

## Impact

The existing Store and authenticated service gain one fixed lifecycle operation and optional history attribution. Existing guest controllers, device storage, filtering and More-menu owners gain the presentation. Update `docs/contracts.md`, `docs/backend.md`, `docs/ui.md`, `README.md` and the narrowly affected agent guidance in the implementation change. Protocol/base schema remain 2; capability negotiation prevents unsupported requests.
