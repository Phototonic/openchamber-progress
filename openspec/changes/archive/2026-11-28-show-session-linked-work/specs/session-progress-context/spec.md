## MODIFIED Requirements

### Requirement: Optional source-labelled host work context

Session details MAY show validated host agent and linked-resource metadata. All such context SHALL be bounded, literal and labelled as host-supplied. It MUST NOT determine plan identity, assignment, progress, acceptance, completion or workflow selection. Missing or malformed data SHALL NOT invalidate the session. The guest MUST NOT fetch linked resources, execute their content or change host or plan data.

#### Scenario: Metadata is present
- **WHEN** verified matching session metadata contains an agent and linked issues or changes
- **THEN** expanded Sessions retains its bounded, literal host-reported agent and link titles for each matched participant, distinct from reported task facts

#### Scenario: Metadata is missing or hostile
- **WHEN** optional metadata is absent, malformed, oversized or contains markup-like text
- **THEN** absent or unusable links leave no placeholder, invalid fields are dropped or inert, and admitted labels appear as bounded literal text, never rendered markup
- **AND** neither a new destination, an assignment nor an automatic fetch results; the plan remains readable

## ADDED Requirements

### Requirement: Main-session links beside the selected plan

The board and rail SHALL show the selected plan’s verified main-session links as compact, host-labelled, read-only header chips. They MUST NOT infer numbers or resource state. Only explicit activation of a validated address may invoke the supported host opener. Discovering and presenting links SHALL use existing session snapshots, without a new permission or network call.

#### Scenario: A linked issue and change
- **WHEN** the selected plan’s verified main session supplies an issue and a change with web addresses
- **THEN** its board and rail header show their literal titles without changing the report or implying the change shipped
- **AND** when the snapshot contains no usable links, neither surface shows a chip group, placeholder or notice

#### Scenario: The visible chat is not the owner
- **WHEN** a board selection or a rail plan reached through a contributing session belongs to a different main session than the current chat
- **THEN** only the selected plan’s verified main-session links can appear in the header, never a union of participant or visible-chat links
- **AND** without an unambiguous current match in the verified source there are no header chips, even for a same-spelled session identifier

#### Scenario: The host changes the links or the reading changes
- **WHEN** a current session snapshot replaces or removes a link without a new report, or the reader switches to a plan, source or account without matching links
- **THEN** the header reflects the new context and no previous chip remains actionable for it

#### Scenario: The reader opens a linked resource
- **WHEN** the reader explicitly activates an admitted chip by pointer or keyboard
- **THEN** the guest asks only OpenChamber’s supported opener to open that validated HTTP(S) address, once for that activation
- **AND** a refusal leaves the plan intact, gives localized feedback and never falls back to direct navigation or a network request

#### Scenario: Links in a narrow rail
- **WHEN** there are several links or a long title on a narrow rail
- **THEN** the source label, controls and plan actions remain legible and keyboard-accessible in the existing host theme, without whole-frame horizontal scrolling or a new card, banner or multi-line notice
- **AND** if more links are known than represented, the compact qualification does not claim an exact total
