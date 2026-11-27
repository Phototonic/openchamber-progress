## MODIFIED Requirements

### Requirement: Fresh bootstrap preserves refusal boundaries

Fresh preparation SHALL reuse existing directory and private-publication owners. Creation and source registration SHALL keep budgeted intent/completion boundaries. New databases SHALL atomically initialize the frozen Store ID and capture-off value without a schema change. Both step families SHALL support explicit same-operation recovery of a proven first journal save. Unproven partial creation SHALL be retained and refused, not adopted, cleaned or repaired.

#### Scenario: Managed directory exists without a valid marker
- **WHEN** a crash leaves the managed directory created but its marker absent or invalid
- **THEN** prepare refuses with a fixed diagnostic and retains the directory
- **AND** its emptiness or private permissions do not authorize adoption

#### Scenario: Marked directory without a journal
- **WHEN** the managed directory and marker are valid and private but no journal was published and no stage remains
- **THEN** fresh same-target validation and confirmation may publish the initial journal
- **AND** this does not authorize adopting an unmarked directory or ambiguous staging

#### Scenario: Reopen after initial publication but before stage removal
- **WHEN** both the published sequence-one journal and its identifiable temporary name survive as the only two links to the same verified private file in the marked directory
- **THEN** Setup can show that operation and its next explicit action after restart, without changing either name or claiming capture from the journal
- **AND** opening Setup, status, inspection and companion loading do not continue setup or grant Store admission from this observation

#### Scenario: Explicit retry finishes the same save
- **WHEN** an exact confirmed begin is retried, or the user explicitly continues the validated pending operation, and the request and pair still match under both writer fences
- **THEN** Setup removes only its verified temporary name and checks the ordinary single-link journal before replaying or processing the requested action
- **AND** finishing the save preserves the published file, bytes and operation identity, and does not itself advance the sequence, repeat a setup effect or change capture
- **AND** subsequent retries use ordinary receipt and sequence rules, including after another interruption following stage removal

#### Scenario: No authority to finish the save
- **WHEN** the family, request, sequence, target, package, object or bytes no longer match, or the necessary fence or work budget is unavailable
- **THEN** the failed precondition does not authorize unlinking, replacement or another effect

#### Scenario: Store creation interrupted
- **WHEN** a store-directory completion or database initialization cannot be proven from the same operation's durable evidence and fresh checks
- **THEN** the partial state is retained with an explicit recovery refusal and no binding/enable effect
- **AND** a completed database initialization may be reconciled only against the frozen Store identity, supported schema and expected pre-registration state, without a writable repair

#### Scenario: Ambiguous publication or sidecars
- **WHEN** interrupted creation leaves a lone or unidentified stage, unrelated or additional links, ambiguous publication files or orphan database sidecars
- **THEN** Setup refuses and retains them for separately authorized diagnosis
- **AND** it does not delete or repair them to make creation succeed; other owned-file hard-link checks remain unchanged
