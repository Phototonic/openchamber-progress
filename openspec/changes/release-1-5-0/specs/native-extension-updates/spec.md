## MODIFIED Requirements

### Requirement: Accurate source and update instructions

README and Setup SHALL describe only behavior supported by measured installer/update evidence: default-branch/main selection, explicit `#main`, fixed release tags, and manual folder/ZIP replacement. They SHALL state that the development branch is source only and not installable. They SHALL explain that host offers are version-based rather than commit/byte-based, and SHALL NOT promise a README custom-scheme install button or untested platform behavior.

#### Scenario: Branch and tag selection
- **WHEN** disposable default, explicit-main and tag installations are checked after their refs diverge
- **THEN** each follows its selected ref rather than another branch or the newest tag
- **AND** a same-version byte/commit change is not described as sufficient for an automatic host Update offer

#### Scenario: Ref without built entries
- **WHEN** a disposable installation or update selects a ref that carries no built entries, as the development branch does
- **THEN** the installer refuses it and a previous installation keeps its files
- **AND** README and Setup do not offer `#dev`

#### Scenario: Folder or ZIP installation
- **WHEN** a folder or ZIP install is listed and update checking runs
- **THEN** it has no Git update offer
- **AND** instructions identify manual replacement/rebuild, without equating local folder watching with remote self-updating or promising Git-equivalent replacement retention
