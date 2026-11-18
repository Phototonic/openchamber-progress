# Windows relies on default per-user permissions

## Why

On native Windows, every ownership, privacy and ancestor check started Windows PowerShell synchronously (1 to 2.4 seconds each). The companion runs inside the OpenCode process, and loading it, guarding a report, running a tool hook and answering a status request each started one or more of them. That blocked OpenCode's event loop for tens of seconds, so its model catalogue request timed out and the model list stayed empty for the life of the process.

The maintainer decided the checks are not worth that cost for a per-user extension: Windows state is protected by the user profile's default permissions, like other per-user applications.

## What Changes

- **Breaking for a stated check:** Windows no longer queries, applies or repairs ACLs, and no longer refuses a root for its owner, its permissions or the permissions of an ancestor. No process is started for any permission check, on any platform.
- Windows keeps the checks that need only plain filesystem calls: drive-qualified path syntax, canonical path, symbolic link and junction refusal, hard-link refusal for owned files, content-ownership markers, hashes and schema validation. Directories are created with default inheritance.
- Linux and macOS keep their uid and mode checks unchanged.
- The managed companion's load, guard, tool hooks and status inspection start no process.
- The per-request spawn ceiling, the helper cold-start budgets and the PowerShell mutex barrier are removed. The work and response deadlines, the writer slots and the fresh validation of every mutation stay. `accounting.securitySpawns` stays on the wire as a constant 0 so older and newer Setup frames keep working.
- Existing installs whose roots carry private ACLs keep working unchanged; their ACLs are never touched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `managed-companion-delivery`: the binding's permission checks on Windows, and a new requirement that the companion starts no process.
- `windows-setup-responsiveness`: health, request bounds, step authority and native evidence no longer involve security helpers.

## Impact

Affected owners: `shared/platform.ts` and every caller of its Windows checks, the managed setup engine and its budget, the service request worker's writer fence, the Windows native and portable tests, and the setup, backend, contracts and compatibility guides.

Protocol and schema stay at 2. No route, request field, store format or capability changes. Fixed diagnostic codes stay accepted so earlier journals and clients keep working, although these codes are no longer produced.

## IN / OUT / Must NOT have

IN: removing the Windows ACL queries everywhere; a test that proves no process starts on the companion, setup and service paths; guides and these specs.

OUT: any replacement permission check; archiving this change, which the release pull request does; release notes and the changelog.

The change MUST NOT alter Linux or macOS mode checks, and MUST NOT remove canonical-path, link, hard-link, marker, hash or schema validation.
