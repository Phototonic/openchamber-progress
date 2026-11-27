## MODIFIED Requirements

### Requirement: Delivered context notes stay in place on later requests

Delivered notes SHALL replay unchanged on their remembered carriers, except for confirmed loss of child assignments as specified below. A current capsule or refusal SHALL be delivered again only if its text changes or its last carrier is absent. A delivered refusal that clears on a complete read SHALL receive the existing fixed cleared line. Removing the system section MUST remove every added note from that request.

#### Scenario: Later requests keep earlier notes
- **WHEN** a later request extends the same stored history and no child assignment note is being cleared
- **THEN** the remembered notes stay on their carriers, so the messages begin with the previous request's messages byte for byte and the stored conversation contains none of those additions

#### Scenario: A sub-agent's plan moved on
- **WHEN** a sub-agent session sends two requests and an eligible plan's revision changed between them, or the capsule lookup timed out for the second
- **THEN** the system section is identical on both requests; after a revision change the second request carries the new capsule after its latest message, and after a timeout it adds nothing, while the earlier capsule stays where it was

#### Scenario: A refusal appears and clears
- **WHEN** a delegation refusal note applies to one request and not to a later one
- **THEN** the system section is identical on both, the note stays where it was delivered, and after a successful, complete read with no refusal the fixed cleared line is added after the later request's latest message; a failed read adds nothing

#### Scenario: Standing note after its carrier is gone
- **WHEN** a still-current capsule or refusal note was delivered and a later request no longer holds that carrier, after compaction, a reverted message or an evicted carrier, and the text is unchanged
- **THEN** the current capsule or refusal is delivered again after that request's latest message

#### Scenario: Reused tool call identifier
- **WHEN** a later turn's tool result reuses the call identifier of a tool result that carried a note
- **THEN** the newer tool result does not receive the earlier note

#### Scenario: Section removed
- **WHEN** any path removes the section, such as capture off, the report tool unavailable, the source unverified or a failure in the hook
- **THEN** the section is absent as before, every note the companion added is removed from the request, and no new note is added

## ADDED Requirements

### Requirement: A child stops receiving obsolete assignment details on confirmed loss

When a successful, complete and unabridged lookup for the same verified child, store and source finds no eligible assignments, the companion SHALL retire that child's remembered assignment capsules. If any would be replayed, it SHALL replace them with one fixed neutral line in place of the most recent one present. It MUST NOT change other notes, original message content, the stored conversation or reporting authority.

#### Scenario: The last assignment is unlinked or its plan is deleted
- **WHEN** a later eligible request still contains a carrier for a delivered child capsule and confirms there are no assignments left
- **THEN** none of the earlier child capsule versions are replayed, including any delivered after compaction; the sole replacement is `Agent Progress note: the earlier assignment note is no longer current.`
- **AND** unrelated notes on the same message survive in order, the system section is unchanged and subsequent empty reads do not add more lines

#### Scenario: Absence is not established
- **WHEN** no lookup took place, it failed, its identity did not match, or discovery was incomplete or omitted candidates
- **THEN** no capsule is retired and no replacement is produced on that evidence; existing eligibility and section-removal rules still apply

#### Scenario: Previously delivered text is no longer in the request
- **WHEN** the complete empty lookup occurs while none of the obsolete capsule carriers is present, or no capsule was ever delivered
- **THEN** no line is introduced, and bringing an old carrier back does not bring its retired assignment text back

#### Scenario: The child receives another assignment
- **WHEN** a later read finds eligible assignments after the earlier capsules were cleared
- **THEN** the current capsule is delivered normally, without restoring the retired versions
