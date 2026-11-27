## ADDED Requirements

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
- **THEN** the device-number exception does not apply, and no selection or recovery authority is inferred
- **AND** inspection, review, Resume, migration and removal keep their existing identity checks

### Requirement: The panel distinguishes a Setup refusal from an outage

When a responding service identifies a Setup admission refusal, the rail panel SHALL direct the user to Setup in English, Russian and Simplified Chinese instead of reporting that Progress is not responding. The read MUST remain a failure, with its diagnostic retained and any retained progress marked stale.

#### Scenario: A responding service refuses the selected installation
- **WHEN** Setup admission leaves health refused with `managed-migration-conflict`
- **THEN** the panel identifies a Setup problem and the user can open Setup without starting a change
- **AND** the refusal neither triggers a plans request nor appears as a new installation or an empty board

#### Scenario: The service did not identify a Setup problem
- **WHEN** the host cannot reach the service, or a reply identifies a busy, corrupt or incompatible Store
- **THEN** the panel retains the corresponding transport or Store failure instead of diagnosing a Setup conflict
