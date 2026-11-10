# Quieter sub-agent coverage warnings

## Context

`runs_format` currently has an exact version-1 definition and one permanent loss bit. `runsInstalled` validates the complete `runs_*` object set and singleton values. `installRuns`, called during companion activation inside `BEGIN IMMEDIATE`, can upgrade only the exact preceding epochless extension. Store opens and reads do not migrate.

The loss helper is shared by storage/admission failures, payload/evidence bounds, ambiguous or contradictory event intervals, dropped claims and observation interruptions. `readRuns` exposes the bit and includes `capture-loss` in coverage reasons. Guest code converts it to an unqualified roster note. The preceding UI change moves routine notes into a muted Partial disclosure; this design adds attention and dismissal to that surface, not another warning layout.

There is already a suitable write transport: the guest's guarded `host.serviceRequest`, the host-injected bearer, and fixed authenticated service POSTs. The reconciliation route supplies the nearby bounded-body and verified store/source/root precedent. There is no existing cross-view invalidation channel in these owners. Ordinary visible refreshes are therefore the synchronization mechanism.

## Goals / Non-Goals

Implement the behaviour in the proposal and `specs/subagent-loss-notices/spec.md`, without weakening run evidence, schema validation, capture-generation fencing or coverage honesty. The proposal's Must NOT have list is binding. The notice changes attention, never the truth of a run or task.

## Decisions

### 1. Run storage format 2; retain the permanent bit

Keep the base SQLite `user_version`, public envelope `schemaVersion` and `protocolVersion` at 2. Increment the private run storage format to 2. Extend its single format row with:

| Field | Meaning |
| --- | --- |
| `loss` | Existing permanent indication that retained recording coverage has a gap; never cleared here |
| `last_loss_at` | Nullable backend wall-clock milliseconds at the last successfully persisted loss detection |
| `loss_sequence` | Nonnegative safe integer incremented for every committed call to the existing loss helper |
| `dismissed_loss_sequence` | Nonnegative safe integer, at most `loss_sequence`; acknowledgement through that detection |

Fresh storage has no loss, null time and both sequences zero. Migrated version-1 loss 0 has the same values; migrated loss 1 keeps loss 1 but also has null time and both sequences zero. A positive sequence requires loss 1 and a nonnegative, Date-representable integer timestamp. Sequence zero requires null time and dismissed sequence zero. Validate these relationships as well as exact SQL definitions and singleton cardinality. Refuse unsafe counter increments rather than admitting values that cannot round-trip safely.

The centralized loss helper updates the permanent bit, timestamp, sequence and existing run revision atomically. It does not reset the dismissal checkpoint: the increment naturally makes the new detection unacknowledged, including within the same millisecond or after clock reversal. Existing loss/no-loss classification remains unchanged; clean reads and ordinary duplicate observations do not create detections. A sequence is an acknowledgement fence, not a user-visible count of lost runs.

**Why:** timestamps alone cannot fence equal-time events or backwards clocks. Keeping the original bit preserves all existing coverage disclosures and old guest compatibility. A new side table hidden from the strict run validator would let older producers silently write gaps without updating the new metadata, so that alternative is rejected.

### 2. Explicit, atomic activation migration

Freeze exact known definitions for current version 1 and its preceding epochless variant. Validate the entire source schema and singleton values before any DDL. In one existing activation transaction:

1. For the exact epochless predecessor, apply the already-supported observation-epoch/trigger upgrade without inventing evidence on old rows.
2. Rebuild the format singleton with the exact version-2 definition, preserving loss, generation and existing state, initializing the metadata above and incrementing run revision once to retire pre-migration cursors.
3. Preserve every run, candidate, job, lease, intent, claim, retirement fence, receipt, plan and existing observation epoch. Revalidate the final complete schema and row invariants before commit.

Because the old table has `CHECK(version=1)`, merely updating its version is invalid. Use a transactional table replacement under the same name; handle any affected owned triggers explicitly. Do not rely on table renaming that silently retargets trigger references. Inject faults across the replacement and prove rollback restores the original schema and values, with no staging objects left. Repeated activation of version 2 is a no-op.

New readers recognize the exact current epoch-bearing version 1 as a read-only compatibility input, as well as version 2. They return ordinary version-1 data without notice capability until activation upgrades it. The older epochless variant retains its existing requirement for explicit activation before run reads; absence remains unavailable. New run writers, including reconciliation admission (which can itself detect loss under capacity pressure), require format 2 and otherwise refuse with the existing schema error. This does not block independent base progress operations. History requests to the new service cannot succeed during that pre-activation interval; existing UI failure/retry handling remains truthful. A new guest talking to an old service can still use that service's existing reconciliation behaviour. No GET, health check, ordinary open or dismissal performs migration. Partial, foreign or future definitions still fail closed without repair.

### 3. Backend wall time determines attention, not browser time

Capture uses the backend process clock (`Date.now()` at detection), not a native event's creation time, a dispatch timestamp or a browser-supplied time. The service evaluates the notice against the same host wall-clock domain at read/POST response time:

`attention = loss && lastLossAt !== null && max(0, readAt - lastLossAt) < 86_400_000 && sequence > dismissedThrough`

Exactly 24 hours is old. Null-time legacy loss is never recent. Time passage changes the derived response, not stored revision or state. Existing polling will repaint when `attention` changes even though `readAt` is excluded from ordinary repaint comparisons. No expiry timer or time-driven database write is added.

A future timestamp relative to the service clock has age zero, rather than silently hiding a gap. A backwards clock can extend or restore attention for an undismissed known gap; dismissal remains valid because its fence is not time-based. A forward jump can age a gap out. This is a wall-clock policy, not a guarantee of elapsed physical time across machine-clock changes. Browser clock/timezone differences affect date presentation only. Use controlled backend Date time and the existing explicit `readRuns(..., now)` seam in tests; never wait 24 hours or repurpose native-event clocks.

Persistence remains best effort when the store itself cannot commit. A failure to write the loss metadata cannot truthfully yield a persisted detection date; keep existing unavailable/error handling and passive-capture isolation. Do not add a second persistence system or retry ledger.

### 4. Additive wire metadata; no base protocol bump

Keep `subagentRuns:1`, `capture.loss`, existing counts and coverage reasons. Return `runFormat:2` for upgraded stores. Add the following `capture.lossNotice` object only for format 2:

`{ sequence, lastLossAt, dismissedThrough, attention }`

It is present even when there is no loss, with zero sequences, null time and false attention. It is absent for a supported version-1 read and an unavailable extension. The other capture fields keep their existing meanings.

The new adapter validates format/availability combinations, the entire object, safe integers, timestamp range, stored-state relationships, attention against server `readAt`, and consistency between the loss bit and the `capture-loss` reason. Format-2 replies missing or contradicting metadata are invalid, not silently treated as legacy. Keep existing byte, identity and source bounds. Old replies genuinely lacking the capability remain readable and are normalized to unknown-date, non-attention loss with no dismissal control. Do not claim these old-service gaps happened before an update; that statement is only justified by migrated format-2 state with loss 1 and sequence zero.

Compatibility matrix:

| Combination | Behaviour |
| --- | --- |
| New service, exact current format-1 store before activation | Reads remain available; no timestamp or dismissal capability; new-service run mutations refuse until activation; no read-side migration |
| New service and new guest, format 2 | Full dated/acknowledged attention behaviour |
| Old guest and new service, format 2 | Existing parser ignores additive metadata and retains its old loss presentation; it cannot dismiss and never claims complete coverage |
| New guest and old service, supported format 1 | Muted persistent loss disclosure, unknown date, no short loss line and no dismissal request |
| Old run-aware service/companion and format-2 store | Exact schema validation rejects the new format without rewriting it; the old service's health path can return `503 schema`, making the guest unavailable, not merely hiding the notice |
| Pre-run base schema-2 writer and format-2 store | Existing base progress operations can remain compatible; preserved triggers must still fence capture toggles and protect run associations, as verified by the unmodified historical-writer test |

A base protocol bump would unnecessarily reject all progress reads in old guests. Additive metadata is enough, but it does not make older run-aware binaries compatible with new storage. Coordinated outputs are still required for the intended UI outcome.

### 5. One bounded, authenticated acknowledgement endpoint

Add `POST /v1/subagent-runs/dismiss-loss` through the existing guest service proxy and route owner. It is query-free, uses the existing 16 KiB run request limit, strict UTF-8/JSON parsing and rejects duplicate/unknown keys (including escaped duplicate names). Its body contains only `storeId`, `binding`, `source`, `root`, and positive safe-integer `observedLossSequence`.

Reuse verified identity checks: current store ID and bound source, a verified source, and an already-known root. The root provides existing authorization context; the acknowledgement itself is store-wide, not root-, plan-, account- or browser-scoped. The host bearer remains outside guest code. No new grant, credentials, filesystem input, SQL, native outcome or arbitrary user identity is accepted. Capture may be disabled: this is a notice preference, not recording or reconciliation.

Inside `BEGIN IMMEDIATE`, validate format 2 and compare the requested fence:

- If it equals the current positive sequence, advance `dismissed_loss_sequence` to it, bump run revision only if the checkpoint changes, and commit.
- If it is already at or below the persisted dismissal checkpoint, return a successful no-op, even if a newer detection now exists. The reply must show that newer detection's current attention.
- Otherwise a stale or future sequence returns `409 conflict` without changing state. Never acknowledge a newer detection that the user did not see.

Return a bounded identity-echoing envelope with protocol/schema 2, `runFormat:2`, store/binding/source/root, current `revision`, `readAt`, `capture`, the requested `acknowledgedLossSequence`, and `coalesced`. The guest validates this reply instead of assuming HTTP 200 means every current warning is quiet. Unsupported format-1 writes fail with the existing schema error, malformed input with invalid, and authorization/storage failures use existing fixed error handling. Repeated acknowledgements cause no repeated revision bump, queue work or task mutation.

The serialized transaction handles both race orders: a new detection committed first makes an old unacknowledged request conflict; one committed after dismissal gets a greater sequence and warns again. This also works for two store connections and equal/backwards timestamps.

### 6. Extend the current visit and note, not a notification framework

The capture-loss roster note gains its specific last-date/legacy/attention information. It is always present when `capture.loss` is true. Old or dismissed loss therefore keeps `coverage.reasons`, `coverage.complete=false`, the muted Partial badge and `section.dataset.complete=false`. Do not derive completeness from attention or from the presence of a Work Status line.

Rail and board use the prerequisite disclosure. Only active loss attention changes Partial to the warning/orange tone, using existing theme tokens and a textual accessible description. The date remains inside the disclosure after dismissal/ageing. Other routine notes and Load more history are unaffected. Work Status shows its one short loss line only while attention is true; its existing priority for other genuine unavailability notes remains unchanged. Existing no-plan/nothing-to-show section gating remains unchanged.

`RunsController` owns the bounded explicit dismissal, pending/error state and read identity guards. No action is offered on Work Status or without supported metadata. Disable duplicate submission while pending. Apply acknowledged capture metadata to the initiating view immediately, invalidate held pre-mutation reads/page replies and stale cursors, and refresh through the existing owner. Compare returned revisions so a delayed acknowledgement cannot overwrite a newer detection already read. An older successful duplicate acknowledgement may still return active attention; never hide it optimistically. Store/binding/account/root changes, hidden/disposed visits and detached controls cannot send a new request or paint an old result; an already-sent write may finish only for its captured store.

Other open surfaces learn the persisted acknowledgement on their next successful ordinary refresh; hidden views read on return. A disconnected view cannot claim confirmation. There is no new cross-frame channel, stored browser preference or polling cadence. Preserve disclosure state and use existing focus handoff/announcement conventions when the dismiss control disappears; do not take focus from a different control or frame.

### 7. Approved user-facing copy

- Badge: **Partial**.
- Loss sentence, including the short Work Status line: **Some run information wasn’t recorded.**
- Known date, appended inside the disclosure: **Last detected: {date}.**
- Migrated loss with unknown date, appended inside the disclosure: **This happened before the update; the date is unknown.**
- Older-service fallback date text: **Date unknown.**
- Active badge accessible description: **Recent recording gap.**
- Control: **Dismiss warning**.
- Control explanation: **Quiets this warning for this store. New recording gaps will warn again.**
- Successful dismissal announcement: **Warning dismissed.**
- Failed dismissal: **Couldn’t dismiss the warning. Try again.**
- Stale unacknowledged dismissal: **A newer recording gap was detected. Review it before dismissing.**

Render the actual stored detection date with the existing locale/date conventions and a machine-readable timestamp; never substitute migration, dismissal or read time. Do not use the success announcement when the returned state still has a newer active gap.

## Risks / Trade-offs

- **Downgrade availability:** a format bump is intentionally incompatible with older run-aware binaries. Preserve data and recover forward with compatible binaries rather than deleting metadata or replay fences to make an older binary run.
- **Permanent incomplete coverage:** successful history recovery cannot prove all past gaps repaired; it does not clear loss. This deliberately retains a muted qualifier indefinitely.
- **Clock corrections:** conservative future-time handling can keep an undismissed cue longer. Sequence fencing prevents that uncertainty from losing or widening acknowledgements.
- **Store outage:** failed writes keep the warning and give a retryable error; they never claim persistence. There is no guaranteed loss record while the database cannot accept writes.
- **Concurrent UI prerequisite:** integrate against its accepted selectors/disclosure lifecycle, not transient files. Do not duplicate its component or reverse its clutter reduction.

## Migration and Rollback Plan

Ship as the separate backend-led stacked pull request after the muted disclosure change, with no intervening release. Update service/guest outputs together; activate the matching new companion to upgrade the store. Read-only version-1 compatibility covers the interval before activation. All already-running old run-aware companions must be reloaded to use the upgraded store; do not silently restart them.

Before activation, code rollback needs no store changes. After migration, keep the store intact and recover forward with a version-2-capable service/companion; reverting only the binaries may make run-aware health/capture unavailable. No automatic down-migration, restoration of stale database copies, loss reset or deletion of additive state is part of this change. A manually chosen older backup could discard later progress and requires separate owner authorization. The setup and compatibility guides must state this limit rather than retaining an unqualified downgrade promise.

## Documentation Integration

- `docs/contracts.md`: extend the run read seam's format, type list, authenticated routes, timing provenance and coverage contract; add the acknowledgement DTO, error/idempotency and compatibility rules. Retain the fixed authenticated API's security model.
- `docs/backend.md`: amend run format/activation paragraphs and add central loss detection/attention/acknowledgement semantics. Audit the passive-failure, safe candidate reclamation, discontinuity, evidence-overflow, byte-bound, contradictory interval, recovery-admission and dropped-claim passages. Their loss disclosures remain permanent; only the attention policy changes. Do not change which cases count as loss, including the safe reclamation that must not latch it.
- `docs/ui.md`: amend the shared-owner map, Sub-agents records/recovery and compact-line rules, dismissed control lifecycle, completeness and testing hooks/QA descriptions on top of the prerequisite edit.
- `docs/compatibility.md`: replace the unqualified run downgrade paragraph with the old-base versus old-run-aware distinction and mixed service/guest matrix; preserve historical native-test limitations.
- `docs/setup.md`: add the activation/reload and post-migration rollback caveat beside lifecycle/history-retention guidance. No new installation flow or permissions are introduced.

## Open Questions

None. User-facing copy and next-successful-refresh propagation to other open views have been confirmed. CLI validation and independent review are delivery gates, not product decisions.
