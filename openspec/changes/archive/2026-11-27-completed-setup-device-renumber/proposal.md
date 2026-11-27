# Keep completed Setup working after device renumbering

## Why

A btrfs subvolume can receive a different device number after reboot. An already completed Setup then rejects the same progress directory or database before reading the Store it selected. The rail panel describes the refusal as “Progress is not responding,” even though the service answered.

## What Changes

- When reading status for a completed format-3 fresh journal with its matching selected binding, verify the directory and database without requiring their historical device numbers to match. Keep every other check. Existing installations need no journal edit, reconfiguration or Resume.
- When the service answers but Setup refuses admission, point the panel to Setup in English, Russian and Simplified Chinese. A refusal remains a failed read, not an empty list or an invitation to set up a new Store.

## Capabilities

- **Modified:** `windows-setup-responsiveness` — the existing request-driven Setup and health capability covers all supported platforms. Specify its terminal observation boundary and the panel's handling of a responding refusal.
- **New:** none.

## Scope and non-goals

Only completed status observation and panel feedback change. **Do not** change journal contents, formats, migration consent, capture control, data admission, permissions, health protocol or request budgets. Reboot recovery for unfinished format-3 operations, format-2 manifest claims and removal receipts is separate work: it needs stable volume/subvolume identity before a mutation can rely on the same object across boots.

## Impact

Update the fresh Store observer and its Setup-status caller, the guest's admission failure presentation, the setup/contracts/UI guides and existing HTTP and rendered fixtures. No dependency, schema, release-version or generated-output change is required on the source branch.
