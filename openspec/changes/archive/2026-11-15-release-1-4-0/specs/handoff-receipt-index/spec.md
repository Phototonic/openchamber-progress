## ADDED Requirements

### Requirement: Indexed unchanged replay lookup

The handoff receipt lookup SHALL use a compatible ordinary index on source and operation ID while retaining its child predicate and full replay semantics. Receipt absence MUST NOT be inferred from claims, pruning fences or current assignments. The logical protocol/schema version SHALL remain 2.

#### Scenario: Large retained source
- **WHEN** the source contains many plans/receipts, including reused operation IDs across children
- **THEN** the query selects indexed source/operation candidates and still verifies the actual child
- **AND** lookup results and conflict behavior match the unindexed contract

#### Scenario: Combined report followed by unlink and bare replay
- **WHEN** assignment or run state changes after an accepted combined handoff and the operation is reused as a bare handoff
- **THEN** the retained receipt still causes the required refusal rather than a new accepted claim

### Requirement: Transactional compatible index installation

Index installation SHALL occur only during authorized writable initialization/activation, transactionally and with owned-object shape validation. Read-only access SHALL not create or repair schema. Existing reports, receipts, run/cleanup schemas and supported older writer/reader behavior SHALL remain intact.

#### Scenario: Existing database and interrupted install
- **WHEN** an existing compatible store lacks the index and activation succeeds or fails during installation
- **THEN** success installs the complete index and failure rolls back without partial migration or lost durable data

#### Scenario: Conflicting object name
- **WHEN** the intended index name already identifies an incompatible object
- **THEN** activation refuses visibly without dropping, accepting or rewriting that foreign object

#### Scenario: Downgrade and reactivation
- **WHEN** unmodified supported older code opens/writes/cleans an indexed store and newer code later reactivates
- **THEN** existing data and replay safety remain valid without down-migration
- **AND** a read-only legacy store without the index remains readable without schema mutation
