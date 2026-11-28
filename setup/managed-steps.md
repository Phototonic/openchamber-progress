# Bounded managed setup contract

> **Since 1.5.2 no step starts a process.** The Windows permission queries
> (Windows PowerShell, one to two seconds each) were removed together with the
> six-launch ceiling, the helper cold-start budgets and the account-scoped mutex
> barrier. Windows relies on the profile's default permissions; ACLs are never
> queried, applied or repaired. The step names, the split into separate durable
> requests, the 17-second work and 18-second response deadlines, the writer slots
> and the fresh validation of every mutation are unchanged, and
> `accounting.securitySpawns` stays on the wire as a constant 0. Where this
> document describes launch counts, allocations or ACL checks below, read it as the
> history of why the steps are split, not as a current requirement.

## Fresh consumer contract (wire 2 / journal 3)

Fresh setup is a separate family on the same route: `ManagedFreshStepRequest`,
`ManagedFreshStepResponse`, `ManagedFreshReview`, `ManagedFreshStepProgress` and
`ManagedFreshStepJournal`. `managedFreshStepRequest` and
`parseManagedFreshStepJournal` are strict fresh-only parsers; the existing
`managedStepRequest` / `parseManagedStepJournal` remain migration-only. The
transport dispatcher uses `managedSetupStepRequest`. Do not widen version-1
shapes or translate a wrong-family journal. `managedFreshSteps: 1` is independent
of `managedMigrationSteps: 1`; the integrated service advertises both on every OS.
Setup projects format 3 only as optional `delivery.freshProgress`.
Before a fresh journal exists, `delivery.migration` is `none` and both progress
fields are omitted. Fresh progress is projected only after prepare settles, with
non-null lastCompleted; it never appears in `migrationProgress`. Retained review
capture is freshly observed when the review can do so within budget, otherwise
unknown. Prepare/status projections without an observation remain unknown.

The fresh review/progress disclose `planKind: fresh`, `storeMode` (`create` or
`retain`), `sourceMode` (`create` or `reuse`), `capturePolicy` (`enable-new` or
`preserve`) and the frozen plan. Review also discloses package version and capture.
Missing identities are generated once per private inspection session, then frozen
by consent; retained identities are verified and reused. Managed install ID uses
the existing `managed-` + SHA-256 of JSON `[storeId, source]` derivation.
No mutation accepts replacement paths or IDs. Proposed Binding fields never grant
ordinary Store, selected-binding or companion admission.

`managedFreshPlan` defines exactly four all-batch-zero grammars: new DB with missing
directory uses prepare, store-directory, create-store, expectation, register-source,
publish-binding, enable, reconcile; new DB in a reviewed directory omits only
store-directory; retained DB/new source uses prepare, expectation, register-source,
publish-binding, reconcile; retained DB/reused source omits register-source too.
Retained plans never change capture. Expectation always precedes source registration.

Format 3 retains immutable `fresh` review facts: store/source modes, capture policy,
directory/database and fixed journal/wal/shm sidecar claims, matched source or null,
reviewed capture state and absent selector/journal/canonical legacy claims.
SQLite file claims are native-object-only (`digest: null`), not unbounded hashes
of the database/sidecar bytes; Store owns schema and identity validation.
The target digest is canonical `{binding, planKind, fresh, expectation}`. Plan and
full-request hashes retain the existing canonical owner. Separate `created`
directory/database native-object checkpoints are observations, excluded from that
target digest. Only settlement of the matching durable creation intent may fill
one; it cannot replace an earlier identity or change original consent/facts.
Only pending/complete coarse phases exist, never fabricated removal evidence.

### Frozen storage primitive agreement

The storage lane implements `Store.createFresh(file, {storeId, validate})`, returning
a normal Store handle. `storeId` is the frozen proposed ID; `validate` is mandatory
full same-target/intent validation, called in the helper's read-only preflight
scope. Creation is exclusive, uses mode 0600 (Windows: the default inherited
permissions), checks all fixed sidecars absent, ends the preflight before reservation, and freshly checks
the reserved file/object/ancestors before initialization. The initial schema
transaction installs the frozen ID, capture **off**, schema 2 and receipt index.
It registers no source. Ordinary constructor defaults/partial-file refusals stay
unchanged. Failed/partial files are retained, never reopened for initialization.
Immediately before either exclusive creation, after the final read-only preflight,
the helper rechecks that the request deadline has not passed. A slow preflight can
therefore refuse while the target is still absent and safely retryable.

The platform lane extends `privateDirectory(file, false, {exclusive: true,
validate})`. Mandatory validation shares its read-only path preflight, which ends
before creation. An existing/unexpected directory refuses,
never becomes adopted authority. The caller checkpoints the resulting identity
only through the corresponding durable intent. A crash before that checkpoint
requires manual diagnosis, not automatic adoption. No claim file, repair, new
schema or cached authority is introduced.

These interfaces are frozen for consumers. Portable full-engine tests assert that
no step starts a process on a projected Windows path. Native CI tests default and
custom empty stores, retained reused sources with capture on/off, and a retained
new source with capture off. Requests assert no process launch and eight seconds,
and health answers with zero launches. Safe creation that cannot finish before
the deadline refuses and is retried by a new request. Format-3 observation before storage exists
requires the fresh journal reader, not `readBinding` on an absent directory.
Rollback retains journals/data and requires a fresh-capable build for recovery.

The sections below retain the wire-1 / format-2 migration contract. Wire 2 and
format 3 extend the same engine, worker and single Setup driver, not a parallel
installer. Backend HTTP and rendered synthetic-shell journeys are integrated;
portable tests are **not a native performance result**. Fresh default
native recovery tests replay and restart/pause/resume before and
after creation; migration tests additionally exercise late-worker refusal.
Native acceptance and independent trust-boundary/error-path review remain delivery gates.

## Owners and invariants

- Wire types, step names, limits and state graph: `shared/managed-steps.ts`.
- Private record: `setup/managed-step-journal.ts:ManagedStepJournal`.
- Consumer examples: `tests/fixtures/managed-steps.ts` (synthetic, not traces).
- Extend `setup/managed-migration.ts`, the lifecycle ownership/removal owner and
  the existing private-publication helpers. No alternate installer/remover.
- Preserve bearer authentication, content ownership (POSIX: current-account
  ownership and modes), canonical paths,
  no reparse/hard-linked private files, exact manifest/byte checks, Store/source
  identity and schema checks, independent companion admission, retained history,
  payloads and receipts. Neither a cursor nor journal nor health grants authority.
- No validation result is cached across requests **or mutations**; every write
  boundary rereads the filesystem.
- Serialize across processes for both discovery target and shared Store capture
  control, including ordinary capture controls. Hold no lock over user think
  time. New locking must be crash-releasing or positively reconciled; a timestamp
  or expired lease alone never permits a second writer. Retained legacy
  `.configuration-lock` remains a refusal, not automatic cleanup.
- Coordinate discovery and shared Store writers with separate deterministic
  loopback slots, not one machine-wide port. The UTF-8 keys are
  `scope:<canonical data root>` and `store:<canonical Store root>`: native realpath
  of the existing ancestor plus missing components, lowercased on Windows. Port
  = 25000 + (first four SHA-256 bytes as unsigned big-endian modulo 4000).
  Step forward deterministically, wrapping within 25000–28999, past 25565,
  26000, 27015–27030 (including 27017–27019), 27036–27037, 28015–28017 and 28960.
  This avoids default Linux/macOS/Windows ephemeral client ports and common
  service/game ports; custom client ranges and other listeners can still collide.
  Acquire sorted/deduplicated ports without waiting; release all on any refusal.
  Same-target writers therefore fence, unrelated targets normally do not; hash
  or denylist-remapping collisions remain `managed-step-port-busy`, never
  alternate-port takeover. Let other setup activity finish before retrying; if
  busy persists, check for another program or custom client range using the port.
  Bounded metadata may route a slot but grants no authority: fresh mutation
  admission must match its Store to the held key. Retain the per-request nonce
  and account-scoped Windows mutex/late-child barrier.

Blast radius is Setup transport/status, worker admission, private managed state,
legacy discovery and Store capture control. No progress schema or identity
change is authorized. These declarations import no runtime into existing entries;
generated runtime integration belongs with the engine/client deliverable.

### Unfinished work on renumbered storage

New format-2/3 reviews may freeze private, versioned evidence for derived
targets on directly mounted, single-device Linux btrfs. It identifies the
backing disk or partition, filesystem and exact subvolume, and is included in
the immutable reviewed facts and target digest. Check membership for each
target: a nested subvolume does not inherit proof from its parent mount, and
another root does not inherit the Store's proof. For a planned absent object,
its verified containing directory proves placement only.

Use fresh matching proof to relax **only** the device number in a
historical-to-live comparison. Preserve all remaining native-object and logical
checks and keep live-to-live, saved-to-saved, digest, consent and intent
comparisons exact. A writable snapshot or a block copy on another disk or
partition refuses even with matching bytes and a reused device number. Missing,
inconsistent or unsupported recorded evidence refuses; there is no strict-path
fallback or confirmation override. Without recorded evidence (older journals,
unprovable layouts at review, or other filesystems such as ext4), the historical
device comparison stays strict. Do not add evidence to an existing operation
on replay or resume. Windows and macOS comparisons do not change.

Status never writes. Explicit Continue/Resume on the proved original uses the
same operation, consent and next legal step. Revalidate at each existing effect
boundary, including first-journal settlement, creation, publication, unlink and
between rmdir and history append. Reconnection preserves capture; exact replay does
not duplicate completed effects. A retained receipt still requires absent
discovery and the exact event in the same owned history file, even after later
valid appends. Format-1 upgrade still needs its own explicit review and intact
manifest or exact receipt; it does not override an earlier mismatch. The
completed format-3 status exception is separate and grants no write authority.

If validation refuses before a write, keep the state unchanged; a refusal after an
authorized effect is handled by the existing uncertain-intent rules, not by undo.
Keep the journal and affected files and retry explicitly only after the original
storage and proof are available at the reviewed paths. Older strict readers refuse
an enriched journal even when complete. Roll forward to a compatible service with
the original state intact; no down-conversion or global-loader restoration. See
[Setup recovery](../docs/setup.md#continuing-unfinished-setup-after-a-device-number-changes).

## Negotiation and requests

Advertise literal `managedMigrationSteps: 1` in authenticated health (including
starting) and `SetupRead.delivery`. This capability says the protocol exists,
not that a source is admitted. POST `/v1/setup/managed-step` accepts only the
`ManagedSetupStepRequest` union (wire 1 migration, wire 2 fresh). Unknown keys/versions/actions, non-safe-integer or
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
  Pending with recovery `continue` permits that advance even while worker is
  `unsettled`; the client must not require idle to reconcile the retained intent.
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

Ordinary Setup may include `delivery.planKind: fresh` as a presentation-only hint
even when partial fresh setup has no usable progress. Absence retains the older
migration presentation; the hint grants no admission or recovery authority.
Legacy-folder absence supplies this hint only when no migration record exists.
An existing record's format decides its family; an unreadable format has no hint.
A refused fresh Store observation clears public fresh progress and reports
unavailable for manual diagnosis only for an unfinished format-3 journal with
`created.database === null`, rather than offering Resume on uncheckpointed creation
evidence alone. Checkpointed and complete journals retain pending/complete progress,
unknown capture and the read diagnostic. Private journal state is retained.
Trusted internal hints from the other
journal family fall back to the request's cold reader; the durable journal must
still match the wire version.

All successful requests use HTTP 200 and `ManagedStepResponse`. A recognized
request refusal uses the same envelope with `disposition: refused`, non-null
`error` and available same-target progress. Validation errors are 400; stale
sequence/target/review, unsupported format/version and ownership conflicts are
409, including `managed-configuration-busy`, `managed-path-unverified` and
`managed-scope-unsupported`; worker/coordination busy, deadline, budget and
unavailable storage are 503. A response
failure is not rollback. Unknown operation status is 404, never another target's
progress. Ordinary authentication/method/body-limit failures keep existing HTTP
handling and do not require this envelope.
Accounting uses an integer launch count (always 0) and finite nonnegative elapsed
milliseconds; the monotonic duration may include a fractional millisecond.
Non-null `error` overrides `disposition`, including a `replayed` failed receipt;
clients must render that reply as failed, not continue the success path. A worker
crash is treated as effect uncertainty and requires explicit observation/recovery.

Old-shaped `/v1/setup/managed-migrate` returns exactly HTTP 409
`{"error":"managed-action-required"}` with **no migration
writes**, before candidate discovery. It is never a partial-success 200.
On Windows `managed-inspect` and `managed-configure` also return exactly that 409
object with zero workers or product writes before body parsing.
On Linux/macOS they remain supported for fresh configuration
with no canonical legacy installation or migration journal. They retain the
existing controller's nonce-bound review, explicit confirmation and fresh locked
revalidation. Presence of legacy discovery or any journal refuses these routes
with 409 `managed-action-required` before monolithic legacy inspection or writes;
use negotiated step inspection instead. Legacy/journal inspection refusal is
read-only, with an eight-second undelayed acceptance budget. Local
legacy/journal presence hints refuse before full validation; absent or unreadable hints grant no authority and still require full
fresh validation and the canonical presence check. These hints read no metadata
contents and are not retained between requests or used to admit an effect.
Without a journal, configuration with concurrent legacy discovery and a managed
selection, or a non-directory/symlink legacy entry, refuses with 409
`managed-migration-conflict`, not fresh-configuration authority. Inspection of
that state still returns `managed-action-required` to direct clients to steps.
Without a migration hint, invalid managed metadata retains its precise
ownership/path refusal; step inspection diagnoses metadata behind a hint.
Retain independently bounded capture-off control. No unnegotiated fallback from
the migration client to the old route. Delivery revision stays 1; the new literal
capability is independent.

### Non-Windows fresh-configuration compatibility

The old Linux/macOS inspection/configuration routes remain outside the negotiated
step-request budget and worker boundary. They keep the synchronous 1.3.0
controller, holding the same target-derived scope **and**
Store writer slots for the entire request, including publication and cleanup.
A busy slot refuses before controller admission; fresh configuration cannot race
a migration or capture worker. The fence releases on completion/failure, not on
client disconnection. Partial bootstrap still has the existing recovery limits.

Windows refuses these old routes before work; the current UI uses negotiated
fresh steps on all platforms. A compatibility timeout is not rollback: inspect
state before explicitly retrying; never reset or repair it automatically.
No old-route fallback is allowed from the fresh client if its capability is absent.

The five-second HTTP request/header timeouts limit receipt of bytes (HTTP 408),
not handler execution after body parsing. They are not a five-second setup
deadline and remain unchanged. A step that runs past its work deadline refuses with
`managed-step-deadline`, not a generic `storage` failure.

## Request budgets and stage split

No step starts a process, so there is no launch ceiling to allocate. The service's
monotonic work deadline is 17 seconds from authenticated request admission;
response deadline is 18 seconds, below the 20-second host boundary. Time waiting
for serialization consumes this budget. If a needed fresh validation cannot finish
before the deadline, stop before the effect with `managed-step-deadline` and
return the already-known diagnostic/progress without a synchronous status scan.
After an uncertain effect, return unknown capture and
`managed-step-unsettled`/deadline, retaining intent. Fence a late worker before
any competing request can mutate. Termination is not proof of rollback; health
must continue to answer without any filesystem validation.

The original measured stages were split into the request units below to fit the
old per-request launch ceiling. The split is kept, because journals and the Setup
driver depend on it, but the ceiling itself is gone.

| Old measured stage | New request unit |
| --- | --- |
| inspect | `roots`, `managed-state`, `legacy-discovery`, `legacy-releases` per bounded release group, `store`, `review`; no writes |
| preflight + create | discovery above, then `prepare` alone |
| locked validation | no standalone authority checkpoint; freshly validate the fully discovered target in **each** one-effect mutation request; reread every manifest/binding/hash/Store fact, never reuse an earlier verdict |
| expectation | `expectation` only |
| record writes | initial prepare; intent/completion inside each separate effect; `record-removal`; final `reconcile` |
| removal | one `remove-selector` per staged selector; one `remove-discovery` per root file; then `record-removal` |
| final status | `publish-binding`, `enable`, then `reconcile`; ordinary status is a bounded projection |

Full checks batch **already discovered path claims plus all ancestors**, not
split authorization across requests. Claim paths
include journal/marker/selector, roots, descriptors, manifest, every retained
release file, removal candidates, expectation, history and existing SQLite side
files as applicable. Check object snapshots before/after, then reread and validate
manifests/descriptors and all required hashes/Store facts. A changed manifest,
object or discovered set invalidates the batch. Do not follow a newly discovered
path from an unvalidated manifest or authorize by cached byte hashes.

The bounded claim set is at most 256 paths (ancestors additionally deduplicated);
the byte/request/deadline bounds still apply. More paths or bytes are an explicit
`managed-step-limit` **before confirmation/effects**, not a truncated successful
review. Read-only release inspection may be paged, but full fresh ownership is
still required at every affected mutation. The supported released fixture must
complete; endless bounded refusals do not pass acceptance.

## Effect sequence and partial removal

For an intact legacy installation the immutable plan starts
`prepare(0), expectation(0), disable(0)`, followed by zero or more
`remove-selector(n)`, then `remove-discovery(n)`, then
`record-removal(0), publish-binding(0), enable(0), reconcile(0)`. Other names have
batch 0. Repeated batches are contiguous, server-ordered and zero-based.
Receipt-proven format-1 removal uses the shorter frozen plan defined below; it
never invents missing removal batches or replays already completed removal.

`prepare` creates only owned private managed metadata and the initial format-2
journal; no capture, expectation, loader or selector effect. Reuse the existing
`createManagedBindingDirectory` helper, as the managed-configuration path does,
then publish the initial journal as a **file** inside the validated managed
directory using the existing no-clobber private-file publication. There is no
claim file, atomic-container requirement or directory repair.
Only a fully published, freshly validated prepare checkpoint releases the next
step. Existing managed directories/format-1 records require same-target validation
rather than replacement of foreign bytes.

### Bootstrap recovery and retained limitations

| Durable state at interruption | Explicit retry behavior | Named regression outcome |
| --- | --- | --- |
| Managed directory absent | Freshly validate the confirmed target, then use exclusive directory creation. | `HTTP prepare crash before metadata publication recovers without other effects` |
| Valid private managed directory and exact marker; journal and stages absent | Freshly validate the same target and consent, then publish the initial journal. Before a durable receipt exists, restart may require new inspection/confirmation. | `interrupted prepare at marker retains honest bootstrap recovery` |
| Valid marked directory and single-link same-operation journal | Replay the durable receipt or process the next legal request; never repeat completed effects. | `cold fresh begin already unlinked before worker exit follows ordinary replay` |
| Proven two-link first journal | Setup and step status observe sequence one without unlinking. An exact begin retry or legal next request can finish the save, then use normal step rules. | `cold migration begin settles only the proven first journal pair`; `cold fresh custom Store Continue needs no begin token and advances only the advertised step` |
| Proven pair, but authority or target changed, a writer is busy or work budget is exhausted | Refuse without unlinking or executing the next step. | The `cold migration begin` test refuses stale/wrong-family, busy and deadline requests; `cold fresh custom Store Continue` refuses a changed Store claim and stale sequence. |
| Missing/invalid marker, foreign bytes, unrelated links, a stage alone or old/random stage | Refuse and retain everything for manual diagnosis. A directory path or private permissions alone never establish ownership. | `interrupted prepare at directory retains honest bootstrap recovery`; `initial journal recognizer retains ambiguous links and changed or later records`; `fresh journal retained two-link publication refuses without cleanup` |
| Later journal replacement, expectation, selector, partial Store state or old private configuration lock | Existing validation and recovery rules only; the first-journal exception does not apply. | `fresh expectation retained two-link publication refuses without cleanup`; `fresh binding retained two-link publication refuses without cleanup`; `fresh target orphan-sidecar refuses without changing retained state`; `missing journal resumes only within a valid marked container; partial or unsafe state is retained` |
| Existing format-1 state | Use the separate same-target review and validated upgrade path. | `upgrade begin prepares once; cold exact retry uses only its durable receipt` |

For both format 2 and format 3, only the first **no-clobber** save derives a
`migration.json.stage-prepare-<sha256>` sibling from the exact saved bytes.
During publication, the exclusive open descriptor pins the staging inode while
Setup checks the stage's device and inode: a runtime may report change time as
birth time, and writing or linking the stage can change that value. Read-only
recovery still checks timestamps for stability.
Matching names are not enough: the names must be the only two links to the same
private native file in the marked directory, with a strictly validated initial
checkpoint and applied begin receipt. Observation grants no Store admission;
the worker rechecks the request, package, target, both writer slots and deadline
before unlinking just the sibling. It then rereads the single-link journal
through the normal owner before any next step. The post-unlink check compares
device and inode, link count, size and modification time; the unlink can change
reported birth time when it follows change time. All read-only timestamp checks
before unlink remain in force. Settlement replaces no bytes and
adds no sequence or effect. A failed settlement of an exact begin retry still
reports the proven checkpoint with the refusal (`cold begin unlink failure reports
the retained checkpoint and allows an exact retry`). Older builds refuse a retained pair; roll back code
only, not state. This does not make directory creation or publication power-loss
safe. There is no claim file or cleanup sweep.

On a refused partial bootstrap, stop migration and retain the state for manual
diagnosis. Follow `docs/setup.md` recovery guidance; do not delete the directory,
publication stage or lock, or restore a global loader merely to make
Setup continue. Public diagnostics contain only stage/code, never local paths.
No safety check is exempted to meet the deadline.

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
  Before writing a failure checkpoint, recheck every recorded volume placement,
  without treating an incomplete effect as successful. Missing or different
  proof leaves the durable running intent and sequence unchanged.
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
The retained intent's evidence may be evaluated as running in a read-only
projection after resume; actual effects still require reading back the exact
published running intent under fresh validation.
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
