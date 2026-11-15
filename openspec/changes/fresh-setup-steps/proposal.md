# Bounded fresh managed setup

## Why

Version 1.4.0 bounds legacy migration, but fresh Windows configuration still uses synchronous inspection and configuration: the portable fixture records 3 and 24 PowerShell launches respectively. Slow helper startup can exceed OpenChamber's 20-second request limit and block health. New users need visible, resumable progress without weakening filesystem or Store admission.

## What changes

- Extend the existing request-driven step engine to fresh configuration, including creation of a new store and reconnection of a valid retained store without legacy discovery.
- Add separately negotiated fresh requests and a format-3 fresh journal; preserve the frozen version-1 migration protocol and format-2 migration records.
- Separate managed metadata preparation, store-directory creation, database creation, expectation publication, source registration, binding publication, enable and reconciliation where applicable. Each request remains within six actual security launches, 17 seconds of work and an 18-second response deadline.
- Reuse Setup's one-request-at-a-time progress, pause/stop/resume, context retirement and reviewed capture recovery. Provide fresh-specific English, Russian and Simplified Chinese copy.
- Retire the old inspect/configure HTTP routes on Windows through a fast compatibility refusal. Retain their existing no-legacy/no-journal compatibility behavior on Linux/macOS.

## Scope and non-goals

**IN:** explicit default/custom-store review; new-store bootstrap; retained-store/source identity and capture preservation; crash/replay/fencing; mixed service/UI behavior; portable, authenticated HTTP, native Windows and rendered evidence; affected contracts and generated outputs.

**Must NOT have:** another installer, journal location, background job, polling loop, security cache across requests or mutations, speculative plugin architecture, global loader installation, automatic cleanup/adoption/ACL repair, new progress database schema, version bump or release promotion. Existing bootstrap refusal windows remain; crash-proof directory publication and universal success at three seconds per helper are not promised.

## Capabilities

### Modified capabilities

- `windows-setup-responsiveness`: extend bounded execution, consent, recovery, compatibility and native acceptance to fresh setup.

The guides remain the contract of record. Update `setup/managed-steps.md`, `docs/setup.md`, `docs/ui.md`, `docs/contracts.md`, `docs/backend.md` and `docs/compatibility.md` with implementation.

## Impact

Affected owners are shared setup wire types, journal/inspection/effect/publication owners, Store creation, the service request worker and route boundary, and the shared Setup adapter/driver/copy. Existing migration and capture-off behavior remain regression requirements. Regenerate affected backend and guest entries using repository scripts, with one final integration owner.

Success requires a genuinely empty native Windows fixture to finish at 2.5 seconds per helper with every request below 20 seconds, not merely a sequence of bounded refusals. Slower or failed helpers must return honest bounded recovery information; no guarantee of eventual completion is made for persistent deadline exhaustion.
