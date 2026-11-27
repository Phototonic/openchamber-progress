# Design

## Decide from the read, not from the rendered string

Use the existing checked child identity and `ResumeSelection`. Clear only on a successful read for this child, store and source with no eligible candidates and neither `incomplete` nor `omitted` set. This also covers the first child request after compaction; its heading differs but its candidates still have assigned scope. A complete empty read proves the absence of eligible work, **not why** it disappeared. No cleanup notification, extra scan or lookup on ordinary coordinator turns is needed.

An empty rendered string is not proof: no valid latest carrier, a skipped or failed lookup, unknown ancestry, timeout, budget stop, omitted assignments or a candidate that does not fit can also produce no text. Preserve the existing replay or section-removal behaviour on those paths. A nonempty result still follows the existing capsule delivery rules.

## Replace only what the companion added

Work within `registerActivation`'s bounded per-session note memory. Keep enough information when composing a note to distinguish a child capsule from other text on that carrier (for example its span in the composed text). Do not search the host's messages for a heading, parse plan titles, or drop the whole carrier. Hints and refusals may have been delivered with the capsule or added to that same carrier later.

On confirmed loss, retire **all** remembered versions of that child's capsule, including portions on carriers absent from this request. Forget the last standing capsule as well. In the most recent affected delivery still present, substitute `Agent Progress note: the earlier assignment note is no longer current.` Remove the other obsolete portions without leaving empty note parts or separators. If none would be replayed, add no line. Keep unrelated text, its order and the original message or tool result intact. Use the existing synchronous replay/update step, carrier identity, memory caps and lifecycle; no second cache or persisted tombstones.

Repeated empty reads replay the replacement in place, not once per turn. A returning carrier must not resurrect the assignment; a later verified assignment is a fresh delivery. A past request, the stored transcript, and content authored by the host, user or model are outside this change.

## Compatibility and rollback

Appending a correction would preserve the prompt prefix, as for refusals, but would keep sending the obsolete details. Replacing the replayed text deliberately gives up that prefix **only where it changes**. No provider-wide cache or signed-thinking compatibility claim follows. No schema, wire protocol, host or service change; an older companion keeps the old behaviour. Reverting the companion change and reloading restores the former replay policy without a migration.
