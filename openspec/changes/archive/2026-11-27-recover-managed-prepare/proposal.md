# Recover an interrupted first journal save

## Why

Setup can finish writing its first operation record and still get stuck on restart. If it stops after linking the finished file to `migration.json` but before removing the temporary name, the next attempt sees two hard links and refuses. The record can be intact; today Setup cannot distinguish its temporary name from an unrelated link.

## What Changes

- Make the temporary name for **initial** journal publication identifiable from the published record. After an interruption, let Setup show the recorded operation without writing anything. An explicit retry or continuation may finish that save instead of requiring manual filesystem work.
- Narrow the documented “never remove a retained link” rule for this pair only. Proving that two names refer to one file is necessary, not sufficient. The initial checkpoint, target, request and ownership checks still apply. Normal binding, Store and companion admission do not accept linked state.
- Keep the unmarked-folder refusal. The ownership marker is already the first file written after creating the directory. Saving its native identity in another file would move the unprotected interval, not close it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `windows-setup-responsiveness`: distinguish a proven first journal publication from ambiguous bootstrap staging for both negotiated Setup families on all supported platforms.

## Scope

**IN:** the no-clobber first save during confirmed fresh setup or migration; observation and explicit recovery after process restart; native Windows filesystem coverage and the affected guides.

**Must NOT have:** adoption of an empty or unmarked directory, a directory claim file, directory replacement, stage sweeping, recovery of later saves or old unidentified stages, lock takeover, automatic startup or status mutations, changed permissions, child processes or compiled helpers. No change to store creation, wire or journal versions, user consent, deadlines, UI controls, legacy installation, release versions or generated source-branch contents.

## Impact

The private publisher, setup journal and engine, bounded worker/status path and tests change. Update `docs/setup.md`, `setup/managed-steps.md`, `docs/backend.md` and the current coverage note in `docs/compatibility.md`. This is not a promise that every interruption or power loss is recoverable.
