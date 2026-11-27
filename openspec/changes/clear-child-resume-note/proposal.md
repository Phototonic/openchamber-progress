# Stop replaying a child's obsolete assignment

## Why

After a coordinator unlinks a child or deletes its plan, the next assignment lookup can correctly find nothing. Yet the companion still sends the old plan title, revision and task IDs on the message that first carried them. There is no new assignment or authority; it is the **earlier note** that keeps appearing.

## What Changes

After an existing, complete read confirms that the child has no eligible assignments left, remove the remembered child resume text from this and later outgoing requests. Where the obsolete text would have appeared, leave one fixed, neutral line. Unlike the cleared-refusal notice, this is a replacement, not an appended correction.

## Capabilities

### Modified Capabilities

- `plan-mirroring-guidance`: narrow exception to replaying delivered notes unchanged.

## Scope

**In:** child assignment notes from ordinary contexts and post-compaction reads; synthetic regression coverage; the affected replay paragraphs in the guides.

**Must NOT have:** per-plan redaction while the child still has eligible assignments, rewriting the stored conversation or earlier deliveries, scrubbing user/tool content, changing coordinator capsules or refusals, new reads, storage, permissions, reporting operations, dependencies or release machinery.

## Impact

Only the companion's outgoing messages change. On the clearing request, the message prefix differs from the first removed assignment onward; cache reuse and provider thinking bound to the old prefix cannot be promised there. The system section remains fixed.
