# Bounded managed migration contract

This is the version-1 wire / format-2 journal contract for the step engine and
Setup client. It is **not an implemented endpoint or native performance result**.
The engine, client parsers/rendering and native acceptance must land together
before advertising support. Existing runtime behavior is unchanged by these
declarations. Release integration updates the public setup/backend/UI guides.

## Owners and invariants

- Wire types, step names, limits and state graph: `shared/managed-steps.ts`.
- Private record: `setup/managed-step-journal.ts:ManagedStepJournal`.
- Consumer examples: `tests/fixtures/managed-steps.ts` (synthetic, not traces).
- Extend `setup/managed-migration.ts`, the lifecycle ownership/removal owner and
  the existing private-publication helpers. No alternate installer/remover.
- Preserve bearer authentication, current-account ownership, safe ancestors,
  no reparse/hard-linked private files, exact manifest/byte checks, Store/source
  identity and schema checks, independent companion admission, retained history,
  payloads and receipts. Neither a cursor nor journal nor health grants authority.
- No cached ACL verdict across requests **or mutations**. A nested
  `platformSecurityScope` does not clear an outer scope. End/reset the actual
  scope at every write boundary; a helper rename alone is not a reset.
- Serialize across processes for both discovery target and shared Store capture
  control, including ordinary capture controls. Hold no lock over user think
  time. New locking must be crash-releasing or positively reconciled; a timestamp
  or expired lease alone never permits a second writer. Retained legacy
  `.configuration-lock` remains a refusal, not automatic cleanup.

Blast radius is Setup transport/status, worker admission, private managed state,
legacy discovery and Store capture control. No progress schema or identity
change is authorized. These declarations import no runtime into existing entries;
generated runtime integration belongs with the engine/client deliverable.

## Negotiation and requests

Advertise literal `managedMigrationSteps: 1` in authenticated health (including
starting) and `SetupRead.delivery`. This capability says the protocol exists,
not that a source is admitted. POST `/v1/setup/managed-step` accepts only the
`ManagedStepRequest` union. Unknown keys/versions/actions, non-safe-integer or
negative sequences/batches, over-limit UTF-8 bodies/paths/cursors, NUL paths and
invalid identities refuse before work. `operationId` is a client-generated
lowercase UUID v4; review/request/target/plan digests are lowercase SHA-256 hex.
Service-generated cursors are opaque, scoped to the environment and inspection,
and may expire on restart. No caller paths occur on mutation/continuation inputs.

- `inspect`: no cursor starts read-only discovery; a cursor advances exactly one
  read-only bounded batch. No product files, journal, capture or selectors are
  written. Only `inspection.state: complete` supplies a confirmable `review`.
  An expired cursor requires fresh inspection. Cancellation needs no request.
- `begin`: echoes the complete review's `expected`, a new operation ID and
  `confirmed: true`. Freezes same-target consent and the ordered effect plan;
  executes only `prepare`. First settled sequence is 1 (expected sequence 0 is
  implicit). The initial request digest is retained for lost-reply recovery.
  Exact retry after restart uses that durable receipt, not an expired review
  nonce. Another operation cannot steal or replace an unfinished journal.
- `advance`: exactly the advertised `step` and `expectedSequence`; one effect
  only. It never loops into a second step, even with spare time. Batch indices
  name a server-frozen item, not offsets supplied to a filesystem API.
- `pause` / `abandon`: settle after the active request is fenced, then record
  the stop. They do not disable/enable, undo, remove files, clear an intent or
  discard consent. The client first stops queuing and waits for its current
  request. A competing in-flight control receives busy/unsettled; it is not a
  cancellation of an OS operation. A frame closing cannot promise to send this
  request: its durable state may remain pending/running until reopened. A positively
  fenced interrupted `running` journal may transition directly to `paused` or
  `abandoned`, incrementing sequence once and retaining the exact intent and
  current/last-completed steps. Worker remains `unsettled` while the effect is
  unresolved; stopping does not claim it committed or rolled back. With an active
  or unprovably fenced worker, return HTTP 503 / `managed-step-unsettled`, with
  `disposition: refused` and unchanged sequence/state/intent; do not queue a stop.
- `resume`: explicit same-target action only, after fencing and fresh validation.
  Advances the control sequence and makes the current step pending; it performs
  no migration effect. An unresolved intent must be reconciled by the following
  `advance` before any new effect. Abandoned is resumable, not a deletion state.
  When recovery is `review`, ordinary resume refuses unsettled without a sequence
  change. Instead send `resume` with `review: {confirmed: true, expected, step}`;
  `step` is only `enable` or `disable`, and must name the current uncertain intent.
  This is a new sequenced action, not changed-content retry of the old advance.
  It accepts fresh same-target re-consent as detailed below, but changes no capture
  bit itself. A reviewed resume is invalid without an unresolved capture decision.
- `status`: bounded observation only; absent operation ID discovers the one
  current same-scope journal. No migration/enable/cleanup or full final scan.
  Ordinary GET Setup embeds the same bounded `migrationProgress`. Cold status
  may report unknown capture, never a guessed off/on value. Explicit inspection
  refresh is read-only, not a second background migration driver.

All successful requests use HTTP 200 and `ManagedStepResponse`. A recognized
request refusal uses the same envelope with `disposition: refused`, non-null
`error` and available same-target progress. Validation errors are 400; stale
sequence/target/review, unsupported format/version and ownership conflicts are
409; busy, deadline, budget, unavailable security/storage are 503. A response
failure is not rollback. Unknown operation status is 404, never another target's
progress. Ordinary authentication/method/body-limit failures keep existing HTTP
handling and do not require this envelope.

Old-shaped `/v1/setup/managed-migrate` returns exactly HTTP 409
`{"error":"managed-action-required"}` with **zero security spawns and migration
writes**, before candidate discovery. It is never a partial-success 200. Apply
the same fast refusal to unnegotiated `managed-inspect`; retain independently
bounded capture-off control. No unnegotiated fallback from the new client to the
old route. Delivery revision stays 1; the new literal capability is independent.

## Request budgets and measured-stage split

Six is the **total real process-start ceiling**, not six logical queries. Count
the first cold launch, failed launch attempts, retries, validation, creation,
post-write checks, journal/lock/staging cleanup and reply construction, including
work in another thread/process. No warm-up outside the charged request. Worker
spawn itself is not a security-process spawn; every PowerShell descendant is.

The service's monotonic work deadline is 17 seconds from authenticated request
admission; response deadline is 18 seconds, below the 20-second host boundary.
Time waiting for serialization consumes this budget. Bound each helper wait by
remaining work time minus required settlement headroom; do not inherit the
30-second cold wait/retry. No automatic cold retry in step mode. Reserve the
remaining spawn/time slots for completion and cleanup **before** admitting an
effect. If a needed fresh batch exceeds the bound, stop before the effect with
`managed-step-budget` or `managed-step-deadline`. Return the already-known
diagnostic/progress without a synchronous status scan. After an uncertain effect,
return unknown capture and `managed-step-unsettled`/deadline, retaining intent.
Fence a late worker before any competing request can mutate. Termination is not
proof of rollback; health must continue to answer without security queries.

The following is a required allocation, not a claim that unmodified helpers fit.
The original stage totals overlap semantic work; do not add them to infer a new
total. All new requests, including status/replay/failure, remain capped at six.

| Old measured stage | New request unit | Security-spawn allocation |
| --- | --- | --- |
| inspect 19 | `roots`, `managed-state`, `legacy-discovery`, `legacy-releases` per bounded release group, `store`, `review` | at most 4 validation + 2 failure/cleanup each; no writes |
| preflight + create 12 | discovery above, then `prepare` alone | 2 fresh validation + 1 private container creation + 2 publication/checkpoint validation + 1 cleanup = 6 |
| locked validation 10 | no standalone authority checkpoint; freshly batch the fully discovered target in **each** one-effect mutation request | 1 full known-path batch per validation boundary, as allocated below; reread every manifest/binding/hash/Store fact, never reuse an earlier verdict |
| expectation 1 | `expectation` only | 1 admission + 1 intent + 1 effect + 2 checkpoint/reconciliation + 1 cleanup = 6 |
| record writes 12 | initial prepare; intent/completion inside each separate effect; `record-removal`; final `reconcile` | same per-request six-slot envelope; no three phase publications plus final status in one request |
| removal 7 | one `remove-selector` per staged selector; one `remove-discovery` per root file; then `record-removal` | each 1 admission + 1 intent + 1 effect + 2 checkpoint + 1 cleanup = 6 |
| final status 11 | `publish-binding`, `enable`, then `reconcile`; ordinary status is a bounded projection | publication/enable use six-slot effect envelope; reconcile 2 validation + 1 intent + 2 checkpoint + 1 cleanup = 6; status <=4 reads +2 failure/cleanup |

Full checks fit fewer launches by batching **already discovered path claims plus
all ancestors**, not by splitting authorization across requests. Claim paths
include journal/marker/selector, roots, descriptors, manifest, every retained
release file, removal candidates, expectation, history and existing SQLite side
files as applicable. Within each fresh batch check object snapshots before/after,
then reread and validate manifests/descriptors and all required hashes/Store
facts under that scope. A changed manifest, object or discovered set invalidates
the batch. Do not follow a newly discovered path from an unvalidated manifest or
authorize by cached byte hashes. Rechecking known safe paths may be coalesced;
new paths require another charged batch or a read-only discovery continuation.

The bounded claim set is at most 256 paths (ancestors additionally deduplicated);
the byte/request/deadline bounds still apply. More paths or bytes are an explicit
`managed-step-limit` **before confirmation/effects**, not a truncated successful
review. Read-only release inspection may be paged, but full fresh ownership is
still required at every affected mutation. Increasing this limit or discovering
that a safe atomic step cannot fit six requires technical review, not weakened
checks. The supported released fixture must actually complete at 2.5 seconds
per launch; endless bounded refusals do not pass acceptance.

## Effect sequence and partial removal

For an intact legacy installation the immutable plan starts
`prepare(0), expectation(0), disable(0)`, followed by zero or more
`remove-selector(n)`, then `remove-discovery(n)`, then
`record-removal(0), publish-binding(0), enable(0), reconcile(0)`. Other names have
batch 0. Repeated batches are contiguous, server-ordered and zero-based.
Receipt-proven format-1 removal uses the shorter frozen plan defined below; it
never invents missing removal batches or replays already completed removal.

`prepare` creates only owned private managed metadata and the initial format-2
journal; no capture, expectation, loader or selector effect. Reuse the unchanged
`createManagedBindingDirectory` helper, as the managed-configuration path does,
then publish the initial journal as a **file** inside the validated managed
directory using the existing no-clobber private-file publication. There is no
claim file, atomic-container requirement, new ACL mechanism or directory repair.
Only a fully published, freshly validated prepare checkpoint releases the next
step. Existing managed directories/format-1 records require same-target validation
rather than replacement of foreign bytes.

### Bootstrap recovery and retained limitations

| Durable state at interruption | Explicit retry behavior |
| --- | --- |
| Managed directory absent | Freshly validate the confirmed target, then use existing directory creation. |
| Valid private managed directory and exact marker; journal absent | Freshly validate the same target and consent, then publish only the initial journal. After restart before a durable request receipt exists, fresh inspection/confirmation may be needed. |
| Valid managed directory, marker and same-operation journal | Validate the journal and reconcile/replay its durable receipt; never repeat completed effects. |
| Directory without a valid marker, foreign bytes, permissive ACLs or any reparse/hard-link anomaly | Refuse with stage `prepare` and `managed-binding-invalid` or the precise allowlisted failure code; never adopt, repair or delete. |
| Retained publication stage or two-link state after interrupted file publication | Refuse ambiguous/invalid state without automatic cleanup, link adoption or overwriting. |
| Existing format-1 state | Use its separately specified full same-target inspection/consent and validated upgrade path. |

Creation is **not crash-proof at every internal boundary**. A crash after directory
creation but before its marker, or between a publication link and stage unlink,
can leave a refused partial state. These narrow manual-recovery limitations are
retained from the existing managed bootstrap in versions 1.2.0 and 1.3.0; this
release does not add a claim-based recovery mechanism. An empty unmarked final
directory is never adopted; it is refused. The normal valid-marker/missing-journal
case is restartable after fresh validation. Tests must distinguish these outcomes
rather than claim that all bootstrap crashes resume automatically.

On a refused partial bootstrap, stop migration and retain the state for manual
diagnosis. Follow `docs/setup.md` recovery guidance; do not delete the directory,
publication stage or lock, change ACLs, or restore a global loader merely to make
Setup continue. Public diagnostics contain only stage/code, never local paths.
All validation, creation, publication and failure/cleanup spawns still count
toward prepare's six-spawn limit. No warming or safety check is exempted.

The documented trusted-same-account-process assumption still applies; there is
no new claim of resistance to coordinated hostile same-account races. Windows
retains its documented process-recovery rather than POSIX directory-fsync/power-loss
namespace guarantee. Crash-proof directory bootstrap is outside this release.

`expectation` verifies package bytes and publishes only the scoped expectation.
`disable` follows full fresh legacy ownership and identity checks, publishes its
intent first, then sets the capture bit off. Pending alone proves neither off nor
on. No discovery removal is admitted before positively observed disable.

The lifecycle owner must expose one-file removal substeps, not a bypass calling
unlink from the controller. Freeze the original complete manifest and candidate
objects in the journal. Every removal freshly validates the remaining complete
owned set, retained releases and Store/source, and reconciles prior missing files
only from that operation's intent/completion evidence. Absence, a receipt for a
different install, or a copied manifest is not removal authority. Refuse foreign
entries, changed hashes/objects, symlinks, hard links and ambiguous staging.
Retain `.ownership.json` until root files and verified staging are removed; remove
the manifest last as a discovery batch. `record-removal` verifies the expected
empty directory, removes that directory, and records the same-install lifecycle
history event idempotently before marking coarse phase removed. Its journal
intent covers both subeffects; a crash between them reconciles emptiness and the
exact history event without a second append. Never remove immutable payloads or
history. The engine must stop if that atomic/reconciled unit cannot fit six.

`publish-binding` uses no-clobber same-target publication. `enable` freshly
verifies removal, selector, expectation, schema and identity before enabling.
`reconcile` freshly verifies transition completion and reads capture; only then
is coarse phase complete and state complete. A user can subsequently disable;
complete does not mean capture must stay on. Managed-load observation remains a
separate fact, not an invented success condition.

## Journal, retries and state machine

The canonical private journal is the existing managed `migration.json`, a
Binding envelope with `migration.format: 2`. It is atomically, durably published
with existing privacy/no-clobber/replacement rules. The format-1 reader checks
`format === 1`, so it refuses unfinished new state rather than treating it as
absence or safe old migration. Keep format 2 even when complete; never down-convert
on rollback. Unknown journal format/state/keys, oversized/invalid claims,
unsupported schema, target mismatch and inconsistent plan/sequence fail closed.
Do not emit its paths, manifest bytes or native identities in public traces.

Persist only observations/claims, never security authority. `consent` binds the
reviewed target, legacy identity/ownership and disclosed frozen plan, not arbitrary
future targets. `planDigest` hashes the canonical ordered plan. `targetDigest`
hashes the canonical object `{binding, legacyInstallId, legacy, expectation}`
(Binding projection only; `legacy` is the discriminated manifest/receipt evidence,
claims in frozen path order). The reviewed
package version/fingerprint must match at expectation/enable; an intervening
package update is not consent to substitute new bytes in unfinished work.
Normalize canonical request JSON for `requestDigest`: recursively
sorted object keys, array order preserved, no undefined or additional keys. Hash
the full request together with target and consent digests, plus the capture renewal
sequence/review digest when authorizing a renewed capture effect. A control request is
also sequenced and has a receipt. Sequence is a nonnegative safe integer and
increments once per settled accepted action (including durable failure and
pause/resume/abandon), never for a status read, replay or intent publication.

The state machine is `MANAGED_OPERATION_TRANSITIONS` plus the ordered step plan:

- Begin settles pending at the next step, with prepare last-completed.
- An accepted advance persists running + intent at the old sequence **before**
  its irreversible effect. Running identifies the intent, not worker liveness.
- Verified completion publishes the receipt, increments sequence and enters
  pending at the next step; reconcile instead enters complete with null step.
- Failure enters failed and retains current step/intent, bounded diagnostic and
  the actual capture observation (unknown when unverified). A failed settlement
  increments once; inability to persist that settlement leaves running/uncertain.
- Pause/abandon enter their named states without changing step or intent. Explicit
  resume enters pending at that same step, never skips to the next effect.
  Pause is legal from pending, failed, or fenced running; abandon additionally
  accepts paused. Resume is legal from pending, paused, failed, abandoned, or fenced
  running; reviewed resume additionally requires the current unresolved capture intent.
  Other control/state combinations refuse HTTP 409 / `managed-step-conflict`
  without sequence change, apart from exact last-request replay. All accepted
  controls preserve an unresolved intent; active workers always refuse as above.
- Restart only reads/reconciles observations: no automatic advance, enable or
  cleanup. A retained running intent is presented with worker unsettled and
  recovery reconcile; the UI must obtain explicit resume before continuing.
- Complete is terminal. Further advance/control calls refuse; exact last-request
  replay is read-only and cannot enable capture again.

Accept an identical retry only for the unresolved intent or the most recently
settled full request digest and expected sequence. Return its committed effect
and sequence without running it twice. Reuse with changed content, wrong target,
future/reordered step or stale competing sequence refuses. Earlier receipts need
not be retained: an old request after another control/effect settled is stale.
If intent remains after resume, the new current-step request reconciles the old
effect before replacing the intent. It never assumes absence means success.
Replayed capture observations are freshly read or unknown, not the old reply's on
value. In particular, an uncertain enable with no durable completion evidence
and an off bit cannot distinguish nonexecution from later user disable: refuse
unsettled, offer fresh explicit review, and **never blindly re-enable**. The same
rule protects later user intent after an uncertain disable. A refusal is honest
recovery, not claimed normal-path completion.

### Re-consent after an uncertain capture effect

Read-only inspection of this unfinished operation can issue a fresh complete
`ManagedReview.expected` token for its current capture decision. Server-side review
binding includes operation ID, current sequence, target/plan/expectation digests,
the full unresolved intent, requested enable/disable decision and freshly observed
capture bit (not an exact observation timestamp). It discloses that the earlier
effect is uncertain and the new decision may override a later manual capture
change. It neither replaces the operation nor
changes its original `consent`, target, plan, package bytes or prior evidence.

After fencing, reviewed resume freshly validates that binding and the same current
step. Expired/mismatched review, different decision/target/package, stale sequence
or a changed capture bit refuses 409 without writes. Unknown capture or
unavailable validation refuses unsettled/unavailable, not renewed authority.
Acceptance atomically appends `{reviewDigest, sequence, priorIntent}` to
`captureRenewals`, retains the original unresolved `intent`, and records the
reviewed-resume receipt at sequence + 1, state pending, same step. The reply retains
the actual capture and uncertain effect, with recovery continue; it is permission
to submit one advance, not proof of capture success. Exact lost-reply replay uses
the receipt without renewing consent again or relying on an expired token.

The following advance first reconciles the prior intent. If its capture outcome
remains ambiguous, only this fresh decision permits superseding it: keep the full
prior intent in `captureRenewals`, then durably publish the new capture intent
with `captureReviewSequence` naming that renewal before any capture effect. This
consumes authorization for that one intent, not arbitrary retries or future
capture controls. The new effect still needs all ordinary fresh prerequisite
checks. A further ambiguous interruption needs another fresh review, never reuse
of consumed consent. Retain all prior renewals under the existing journal byte
limit; if another cannot fit, refuse before writes, never truncate evidence.
Original-consent intents have `captureReviewSequence: null`. Pause/abandon and
ordinary resume retain these facts and cannot mint another authorization.
An old advance retry can only reconcile its original intent; it cannot consume
the renewal. Only a new current-sequence advance bound to the renewal may do that.

For example: uncertain enable at sequence 11 with capture off -> fresh inspection
-> reviewed resume at expected sequence 11 -> pending enable at sequence 12, still
off/uncertain -> advance at 12 -> settled enable at 13. A subsequent user disable
is not undone by replay of that advance. Complete stays terminal; reviewed resume
cannot reopen it. The same rules apply symmetrically to uncertain disable.

### Format-1 recovery without an original manifest

Format-1 pending/removed input is upgraded only by complete same-target explicit
inspection/consent. Retain its binding/legacy identity; map only proven completed
effects to checkpoints. An intact installation uses `legacy.kind: manifest`, the
complete original manifest bytes, their SHA-256 and discovered claims, validated
by the lifecycle owner. A format-1 record cannot supply those bytes after the old
remover has deleted `.ownership.json`; do not synthesize an empty/rebuilt manifest.

If the canonical legacy directory is absent and the existing owner validates the
same-install `remove-capture` history receipt (`removalRecorded`), use
`legacy.kind: removal-receipt`, `ownership: null`, `ownershipDigest: null`, the
absence claim, and `receipt: {history, entry}`. `history` is the private history-file
path/object/hash claim; `entry` is the exact existing JSON line, not a newly appended
event. Freshly validate path safety, privacy, Store/source/schema and the original
binding/legacy ID, then validate that entry's action/install ID with the owner.
These remain claims, not cached validation. Later history appends are allowed
only after fresh validation that the same receipt remains in the same owned file;
replacement/missing receipt or remaining/foreign discovery files refuse. A coarse
removed phase or absent manifest alone proves nothing. This branch authorizes no
selector/discovery deletion and does not infer current capture from the old event.

On confirmed begin, the sole initial write is the format-2 prepare checkpoint:
sequence 1, state pending, phase removed, lastCompleted prepare(0), next step
expectation(0), no intent/renewals, and the begin receipt. This applies also to a
format-1 pending record whose removal is positively proven by that receipt. Freeze
the plan `prepare(0), expectation(0), publish-binding(0), enable(0), reconcile(0)`;
no disable/removal/history append is repeated. Expectation and binding are still
freshly checked/published or reconciled under the normal rules, then the newly
reviewed enable and final reconciliation run separately. No current capture or
completed enable is fabricated from the legacy receipt. If complete removal
cannot be proven, missing/partial legacy files remain a conflict. Never discard
an unsupported record or restore a global loader on rollback.

## Client and evidence boundary

Setup submits at most one request at a time and advances only within the user's
current confirmed journey. It shows the actual step and last completed batch,
pending/paused/running distinction, fixed diagnostic, and on/off/unknown capture.
Off **and unknown** during unfinished work need a conspicuous recovery warning.
No percentage, automatic retry, polling loop, stale-context continuation or
claimed undo on pause. Retire the driver on host/source/frame/context changes;
an old reply cannot restart it. Closing loses local running state, not the warning
or durable work. Reopen/status offers resume, never unattended continuation.

Contract fixtures/typechecks establish shape, sequence examples and compatibility
expectations only. Engine tests must establish actual fresh checks, durable
effects, lock/deadline fences, retry and restart behavior, including interruption
inside prepare and record-removal. Client tests must parse these same fixtures
fail-closed and cover locale, focus, retirement and warnings. Native Windows must
measure every actual spawn and request (<=6 and undelayed <=8 seconds), successful
delayed migration, and zero-query concurrent health. Browser evidence must show
EN/RU phone-width progress, paused-off and failure. None is inferred from contract
unit tests. Recommend independent trust-boundary and error-path review before
accepting the implementation.
