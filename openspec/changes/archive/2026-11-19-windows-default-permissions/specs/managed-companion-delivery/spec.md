## MODIFIED Requirements

### Requirement: Single private verified binding

Service and managed companion SHALL discover the same single descriptor in a dedicated product-owned subfolder of the canonical OpenCode data root derived from XDG data/HOME. They SHALL keep marker, canonical-path, binding and Store/source validation, and private modes on Linux and macOS. Windows relies on the user profile's default permissions: no ACL is queried, applied or repaired. They MUST NOT scan roots, fall back from invalid state or auto-adopt legacy selectors.

#### Scenario: Service environment omits state root
- **WHEN** the service lacks `XDG_STATE_HOME` and an explicit binding variable but shares the supported XDG data root with managed OpenCode
- **THEN** both resolve the same owned descriptor and verify the same store/source without duplicate descriptor copies

#### Scenario: Missing selection
- **WHEN** the descriptor is absent and setup or a dormant companion is inspected
- **THEN** the state is unconfigured and no directory, ownership marker, descriptor or store is automatically created or adopted

#### Scenario: Invalid selection
- **WHEN** the selected directory, marker, descriptor, source scope or Store is invalid, modified, aliased, foreign, unsupported or, on Linux and macOS, non-private
- **THEN** capture fails closed and existing bytes remain intact
- **AND** a present invalid selection is not treated as absence or permission to try another root

## ADDED Requirements

### Requirement: Companion checks start no process

The managed companion's load, guard, tool-hook and status paths SHALL start no child process on any platform. Re-reading the binding uses plain filesystem calls only.

#### Scenario: Windows companion in the host
- **WHEN** the companion loads on native Windows, guards a report, runs a tool hook or answers a status inspection
- **THEN** no child process is started, so the host event loop is never blocked waiting on one
- **AND** a changed or invalid binding still retires the companion and refuses the call
