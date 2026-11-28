## MODIFIED Requirements

### Requirement: Completed fresh Setup tolerates a historical device-number change

On all supported platforms, read-only Setup status for a validated terminal format-3 fresh journal with its matching selected binding SHALL ignore only the recorded device number when comparing the Store directory and database with their respective checkpoints or reviewed claims. All other object, Store, source, schema, capture and expectation checks SHALL retain their existing semantics. Observation MUST NOT rewrite the journal, continue Setup or grant authority to a later operation.

#### Scenario: The same installation reopens after reboot
- **WHEN** the recorded device number differs for the directory, the database or both, and all other checks pass
- **THEN** Setup reports the selection verified, the operation complete and the actual capture setting
- **AND** the following health read reports ready without first requiring a plans read, repair or reconfiguration

#### Scenario: There is more than a device-number difference
- **WHEN** the inode or recorded birth time differs, the live object or sidecar is unsafe, or the opened Store ID or selected source does not match
- **THEN** Setup does not report verified or expose a verified reporting identity, and health does not report ready

#### Scenario: Terminal status evidence is missing
- **WHEN** the journal is unfinished or there is no matching selected binding
- **THEN** the terminal device-number exception does not apply, and no selection or recovery authority is inferred
- **AND** unfinished work requires its own same-target proof, independently of any status result

### Requirement: Durable resumable idempotent steps

Migration and fresh setup SHALL retain private pending/progress records and sufficient intent/completion evidence between requests. Identical current-step retry SHALL reconcile actual durable effects without repeating side effects.

#### Scenario: Journal and resume compatibility
- **WHEN** progress is persisted or resumed
- **THEN** restart/interruption SHALL permit explicit same-target resume with fresh validation and single-writer fencing; changed, reordered or competing requests SHALL not advance stale progress
- **AND** fresh setup SHALL use an explicitly discriminated format-3 journal at the existing location, without fabricated legacy identity or removal evidence
- **AND** format-1 recovery and format-2 migration remain supported; an older operation without separately recorded volume evidence retains its exact historical device checks
- **AND** partial creation that cannot be proven safe SHALL be retained and refused, not repaired or adopted

#### Scenario: Reply lost after mutation
- **WHEN** the current step committed an effect but its reply was lost
- **THEN** retry returns the reconciled committed state without duplicate creation, source registration, removal, binding or capture changes
- **AND** a completed enable replay does not override a later user disable

#### Scenario: Restart or writer interruption
- **WHEN** the service or Setup frame stops between steps or during a mutation boundary
- **THEN** retained progress is shown and explicit resume reconciles the same target safely
- **AND** unknown/foreign locks or unsupported journal formats fail closed rather than being silently deleted or treated as absent

#### Scenario: Older code reads a fresh journal
- **WHEN** an older service or migration-only request encounters format 3
- **THEN** it refuses unsupported progress rather than treating it as absence or a legacy migration
- **AND** rollback retains the journal, selection and data without down-conversion or global-loader restoration

#### Scenario: A response deadline leaves a worker active
- **WHEN** a fresh effect outlives its response deadline
- **THEN** the existing target/Store fence remains held until actual settlement or positively established fencing
- **AND** a competing writer is refused, with no timeout-based takeover or rollback inference

## ADDED Requirements

### Requirement: Unfinished Setup recognizes a proven original mounted subvolume

On eligible directly mounted, single-device Linux btrfs storage, Setup SHALL bind private backing-volume and subvolume evidence to a new operation's reviewed targets. Setup SHALL allow explicit continuation after a device-number-only change only when it freshly proves each affected target is on its original storage and all existing object, consent, intent and writer checks pass.

#### Scenario: Fresh Setup continues after reboot
- **WHEN** a new creation with a settled checkpoint or a retained-Store reconnection is interrupted, only the device number changes, and the reviewed backing volume, subvolume and other facts still match
- **THEN** cold observation performs no writes and the existing explicit step flow can finish the same operation from the next legal step
- **AND** historical claims and consent remain unchanged; reconnection preserves capture and completed steps are not repeated

#### Scenario: Manifest-based migration is interrupted during removal
- **WHEN** a supported volume is renumbered during migration and the remaining owned set, original manifest, same-target evidence and exact removal intent or checkpoints verify anew
- **THEN** explicit continuation reconciles only the recorded removal and can complete without deleting a replacement or recording a duplicate event
- **AND** identity must still verify between removing the empty directory and appending its history event

#### Scenario: A retained removal receipt survives a device-number change
- **WHEN** a newly recorded receipt-based operation resumes on its verified original storage after renumbering, with discovery still absent and the exact event in the same owned history file
- **THEN** later valid appends do not prevent continuation of the shorter plan
- **AND** Setup does not repeat disabling, discovery removal or the history append

#### Scenario: A snapshot or copied volume appears at the selected path
- **WHEN** a writable snapshot with the original inode and birth time, or a block copy on another backing disk or partition with copied filesystem identifiers, is presented at the same path
- **THEN** different backing or subvolume evidence refuses unfinished work even if the device number is reused and the journal, Store ID, source and history bytes match
- **AND** that refusal does not advance or rewrite progress, publish a binding, change recording, unlink files or append history

#### Scenario: The mount cannot prove the target
- **WHEN** a path is in an unmounted nested subvolume, the containing mount is ambiguous, recorded evidence is unavailable or inconsistent, or a different object/unsafe link appears
- **THEN** Setup does not use a containing mount's identity, another claim's identity or user confirmation as a substitute
- **AND** the unchanged strict path may continue ordinary unanchored work but cannot excuse a different historical device; a missing or mismatched recorded witness cannot fall back to that path

#### Scenario: Compatibility and privacy
- **WHEN** a witness is absent from an older journal, unreadable by an older build, or the platform is not eligible
- **THEN** Setup does not upgrade, discard or repair saved evidence to make a changed target acceptable; Windows and macOS device comparison behavior is unchanged
- **AND** collecting or comparing evidence starts no process, changes no permissions and exposes no new disk, mount or hardware identifiers over Setup, health or support output
