# Show who reported each plan update

## Why

History tells a reader when a plan was updated or cancelled. The task list can tell them who reported a particular task. Neither lets them follow the reports for one plan, in order, and distinguish a sub-agent speaking for itself from a coordinator relaying its report.

## What Changes

- Add a collapsed **Activity** section after the tasks in the selected plan's **List**, on the rail and board. Opening it shows the newest page; the reader can page back to the first revision.
- Show each revision's number, recorded time, direct or relayed authorship, and the task IDs named in that contribution. Include user cancellations even though they have no contribution.
- Reuse the existing authenticated History route with an explicit, bounded revision-window read. Ordinary History, including its review digest, keeps its existing behaviour.

## Capabilities

- **Modified:** `progress-surface-hierarchy` gains a requirement for on-demand activity inside List. No new navigation destination.
- **New:** none. This reads existing records; it does not introduce a second activity store.

## Scope and non-goals

**In:** retained revision and report metadata, explicit paging, shared rail/board presentation, English, Russian and Simplified Chinese.

**Must NOT have:** changes to the plan-view switch, Map, Work Status or More navigation; a transcript, document reader, snapshot diff, live activity monitor, activity search, report action or implied assignment. No changes to writers, permissions, record retention, schema, polling, preferences or versions. No registry, rollout flag or new dependency.

## Impact

The Store, local service, guest reader and shared List renderer change. The implementation PR updates `docs/contracts.md` (read contract and compatibility), `docs/backend.md` (source and bounds of the projection), `docs/ui.md` (interaction and labels), `README.md` (where to find it) and `CHANGELOG.md` (Unreleased). Setup, supported runtimes and companion guidance do not change.
