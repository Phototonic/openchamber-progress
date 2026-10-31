# Production backend v2

## Recorded capture comparison

`shared/document-captures.ts` owns bounded metadata discovery and same-plan
pair reads; `shared/document-comparison.ts` owns the DTOs and pure bounded line
diff. Store wraps each request in its existing read transaction. The routes in
`service/server.ts` check expected store, source binding and cleanup generation.
They do not invoke document capture, initialize schema, enumerate source roots,
write a cache or open the canonical source path. The byte/row/work limits and
failure semantics are frozen in [the comparison contract](contracts.md#recorded-document-comparison-additive-revision-1).

There is no source/plan index on the existing captures table. Discovery scans
bounded descending integer-primary-key windows, filters metadata in memory,
and returns continuation rather than claiming a complete scan. A pinned plan
revision excludes newer captures even if unrelated deletion allows SQLite to
reuse an ID below the cursor ceiling. Comparison itself looks up exactly two
same-plan IDs. Metadata and snapshot admission precede driver materialization;
body lengths are checked before loading the two texts. Historical captures are
immutable until the existing plan deletion removes them.

Current package version: **0.3.0**. Here v2 means protocol/schema2,
not a release major. Corrected historical package labels below are0.2.0
and0.2.1; raw earlier local evidence retains the original mistaken labels.
Evidence references in this guide describe local QA records, not consumer deliverables.

`docs/contracts.md` and `shared/progress.ts` are the frozen contract.
Probe DTO/store/scripts are historical fixtures, not a production fallback.
The archived probe HTTP service exists only in tests/fixtures. Panel ID remains
agent-progress-probe (stable openSurface target); companion/skill ID is agent-progress.

## Bounded plan/task search (additive read revision 1)

`Store.search` and `Store.searchState` use the existing read-only transaction owner;
`shared/plan-task-search.ts` is the bounded matcher/traversal helper, not a second
store or index. Exact DTO/query/count/coverage meanings live in
`shared/progress.ts` and `docs/contracts.md` under Plan/task search revision1.
Ready health advertises `planTaskSearch:1`; the two new authenticated body-free
GET routes are `/v1/search` and `/v1/search-state`. Existing routes are unchanged.

Each search window seeks the existing binary primary key `(source,id)` one raw
candidate at a time, using a row-value comparison (or source equality/id seek).
There is no OFFSET, excluded-prefix SQL predicate, full count, JSON membership
EXISTS, FTS or scan of source roots. Cleanup, snapshot and contribution reads share
one transaction. SQLite measures BLOB byte length before text crosses into JS;
only accepted bounded input is parsed. At most64 plan-slot attempts,128 membership
rows and8 MiB input can contribute to one response. Snapshot validation checks
identity, bounded fields/items/links and finite parent/dependency traversal before
matching or context extraction. Invalid/oversized snapshots and membership payloads
produce explicit fixed coverage gaps. Corrupt address keys/cleanup schema fail closed.

Creator/current links resolve session membership without history reads. Otherwise
contributions use the existing `(source,plan,revision)` index in bounded windows,
pinned to current progress revision and cleanup generation. An unresolved membership
check survives in a stateless cursor; it never becomes a false negative at row128.
Task sequences similarly resume inside a plan. Full matching-task classification
is counted once at first accepted emission, with per-plan deltas supplied for the
board's frozen live project/worktree projection. A response-byte pause leaves the
first un-emitted hit pending. At most50 hits/8 ancestors per task and256 KiB output
are emitted; bounded envelope/cursor space is reserved before accepting each hit.

Freshness reads the scalar capture-enabled flag from `meta` alongside current
plan revision and cleanup point lookups for up to50 explicit distinct keys, all
in one read transaction. It does not read detail/history or add a polling job.
Neither operation calls the full source-metadata envelope, reads captured documents, creates schema,
retains cursor state or adds a server cache/connection. A legacy read-only schema2
store remains readable without cleanup activation. Cross-request results are honest
observations, not a global snapshot; consumers must retire stale generations and
bound automatic work at their explicit action/lifetime boundary.

Focused proof commands (Node24, pinned dependencies):

```sh
node --experimental-strip-types --test tests/backend/plan-task-search.test.ts tests/backend/production-storage.test.ts tests/backend/plan-cleanup.test.ts
node --experimental-strip-types --test tests/backend/plan-task-search-service.test.ts tests/backend/production-service.test.ts tests/backend/service-recovery.test.ts
bun run typecheck
bun run test:backend
```

The service test can write sanitized `api.json` under an explicitly supplied local
`EVIDENCE` directory. Fixtures normally use production writes/staged commits;
direct-SQL corrupt/padded/maximal-title inputs are labelled fault injection. Scale
proof scans1,200 plans and1,000-item mixed/deep plans, records three post-warmup
HTTP timing samples and measured work/bytes, and checks bounds rather than arbitrary
millisecond thresholds. Local evidence: `evidence/plan-task-search/backend.md` and
`api.json`. This backend proof does not establish native Windows, browser rendering,
host account isolation, long-session memory behavior or a release/install result.

## Components and trust boundaries

- plugin/index.ts registers one namespaced codemode:false report tool and inline
  skill. It gets actual caller IDs/agent from invocation context and refreshes
  authoritative session/location/project/parent metadata on each call. Ancestry
  lookup is bounded32, cycles/errors stay unknown. No activity/message scraping.
- plugin/activation.ts adds advisory native primary-context/post-execute hooks.
  Verified source/session, enabled capture and effective report-tool availability
  are required for guidance. Generic guidance/file hints need only the current
  authoritative session for delivery. A qualifying plan write can also flag its
  exact verified direct parent in the same project and lexically normalized
  absolute directory, excluding immediately visible cycles. This relay performs
  no session listing, grandparent traversal, plan scan or tool/authority change.
  The first primary attempt after an observed successful
  compaction may additionally resolve bounded ancestry and read `Store.resumePlans`.
  A narrow read-only callback is the only recovery Store access, never the report
  executor or capture path. A bounded single-row enabled query is sampled at hook
  boundaries, including after awaited writer/parent or recovery lookups. Reporting still performs its unchanged
  assignment/ancestry/capture checks.
- shared/store.ts owns mutations, counts, assignment/lifecycle validation,
  immutable revision snapshots, operation receipts, source namespaces, captures
  and capture-enabled control. No await/file/network work inside transactions.
  `shared/progress-resume.ts` supplies the internal source-bound active-plan
  projection on this same connection/read transaction, not a public discovery API.
- plugin/document.ts asserts caller read permission on both requested and
  canonical paths through the supported ctx.permission.assert tool-source API.
  It then opens O_NOFOLLOW/nonblocking, verifies the actual opened target via
  /proc/self/fd before bytes, and checks inode/mtime/ctime/size again after reading.
  UTF-8 and text limits are enforced; symlink target changes require rebind.
- service/server.ts reads the same store through fixed bearer/loopback routes.
  SetupController delegates only validated product operations to setup/lifecycle.
  The service never exposes project files, shell, SQL or generic fetch APIs.

Caller permission evidence: pinned2.1.4 SDK permission/tool types and official
V2.1.2 permission.assert docs (Context7), plus file/permission regression tests.
The SDK supplies authorization, not an atomic file reader; the opened-target
checks are our enforcement boundary. Strict capture supports Linux and native Windows; other
platforms return unavailable before reading. No cross-host/container/NFS support
is claimed. Actual plugin/runtime tests use independent OpenCode2.1.4, no models.

## Identity, attribution and finish

Store UUID and source UUID are durable. Source is an explicit confirmed canonical
config/data scope, not PID/port/title/project path. Multiple installations using
the same scope in one store reuse its namespace. Plugin verifies its resolved
stable XDG config/data roots against the descriptor; unsupported DB/config-dir
overrides fail binding rather than guessing. The descriptor pins store ID and
protocol/schema; a foreign store or future schema is never reset or migrated.

Service sourceBinding is the explicitly configured local scope and carries a
distinct verified boolean. SDK coverage is separate: navigation needs matching
binding/source plus a session verified in the CURRENT host. Other sources stay
readable. Source IDs alone are not universal host identity; UI generation changes
must retire cached responses. General custom/channel/platform roots remain
unverified until their effective paths are supplied/confirmed and producer checks
match. No source authentication discovery is in production code.

Each plan has independent owner/session/source/revision/structuralRevision. Only
actionable tasks count; skipped separate, groups/contributions never inflate.
Children need explicit coordinator links and authoritative ancestry; only assigned
task changes are allowed. Parent relays label reporter and attributed child and
validate assignment/ancestry. Unknown children can start independent work, never
silently merge. Coordinate structure/delegation/finish only; late writes to closed
plans refuse. Successful finish requires at least one non-skipped task and none
remaining. Cancel/fail preserve unfinished work. Reopen is explicit; staged chunks
on a closed plan require reopen on staging and commit but do not reopen alone.

Moving a session preserves plan identity and contributions. Each report refreshes
authoritative location metadata without changing the bound document path. If the
document stays in the old worktree, it remains the source; a relocated document
requires an explicit new binding rather than silently following the move.

## Storage and document consistency

Finished-plan cleanup is the bounded exception to default history retention;
see the frozen API and fixture in `docs/contracts.md`. `shared/cleanup.ts` extends
the existing Store owner, not a second storage engine. Cleanup format1 is additive
to schema2 without changing legacy columns/order or stored snapshots. First-use
read-only preflight precedes a private verified `VACUUM INTO` snapshot outside the
write transaction. Under `BEGIN IMMEDIATE`, eligibility, store/key, progress revision
and cleanup generation are checked again before DDL/action commit. Backup/init
failure never auto-restores or resets data; a race can leave a private recovery file.
Snapshot privacy reuses `shared/platform.ts`: POSIX owner/mode checks, or Windows
native object/ancestor checks and private DACLs. An exclusively created Windows
backup inherits the verified private parent ACL and is checked before copying any
content and after snapshot completion; existing ACLs are never repaired. Changed
public ACLs and hard-linked Windows source state refuse without activating cleanup.
Archived directory filters retain the base's Windows separator/drive spelling
equivalence without folding directory-name case or probing presentation paths.

Archive/restore write only separate cleanup metadata; archive freezes progress.
Delete removes the key's contributions/revisions/captures/chunks/receipts/plan in
foreign-key-safe order and retains a minimal replay tombstone. Persistent main-DB
INSERT/UPDATE guards cover plans, chunks, captures, revisions, contributions and
receipts, including both identities on UPDATE. Already-open old writers are fenced
by SQLite itself; transaction rollback removes preceding partial capture writes.
New writers check cleanup state before ordinary receipt replay. No normal GET,
startup or report initializes this extension. Future/inconsistent extension formats
are refused, not repaired. Rollback retains all guards/tombstones; old readers may
show archived work, never deleted payloads. No secure-erasure claim is made for
free pages, journals, recovery backups or filesystem snapshots. Original source
files and unrelated records are never deleted.

Focused safety/API checks:

```sh
node --experimental-strip-types --test tests/backend/plan-cleanup.test.ts tests/backend/production-storage.test.ts tests/backend/production-contract.test.ts
node --experimental-strip-types --test tests/backend/plan-cleanup-service.test.ts tests/backend/production-service.test.ts tests/backend/service-recovery.test.ts tests/backend/task-timing.test.ts
node --experimental-strip-types --test tests/backend/windows-platform.test.ts
```

The test-only legacy driver extracts **unmodified** Store/progress source from
repository object `498c7e58fc0b53b21edfe71b3ba4abbcca3faee6` into disposable roots.
It runs in separate Node processes both before and after extension activation;
it is not today's Store with checks disabled. This compatibility test needs that
Git object (a source export without Git cannot run it); it does not claim every
historical binary/runtime is certified. Fault checks combine actual process kills,
SQLite lock/page-capacity failures and explicitly labelled snapshot-boundary fault
injection. All history/config/backup fixtures are synthetic and removed on teardown.
The built-entry check is opt-in with `CP_BUILT_SERVICE=1` for stable-input
integration; it restarts the actual service against the same disposable store.

Schema2, prepared statements, foreign keys/check constraints, default rollback
journal,1-second busy timeout. BEGIN IMMEDIATE mutation rechecks enabled/revision,
validates whole batch and writes state/history/attribution/capture/receipt before
COMMIT. Receipt is returned only after commit. Same caller/oid/semantic input
returns original receipt; altered reuse refuses. Expected-revision conflict
returns current revision. No automatic retry, overwrite or history pruning.

Capture/read happens outside the write transaction. Store revalidates revision
and source binding inside it, so concurrent rebind/status updates cannot attach a
capture to a silently changed plan. Failed document reads still commit otherwise
valid reports with diagnostics, retaining last valid bytes/hash/capture ID.
Source paths are absolute stable references and never rewritten on session move.
Changed unconfirmed documents mark checklistSynchronized=false; no Markdown parse.
Unchanged hashes reuse immutable captured bytes and update checkedAt, not body
duplication. Document pagination may pin immutable capture IDs. Current-file state
always says not-rechecked between reports, never stale/stuck from age alone.
Consumers show the last successful capture time and last check time separately;
current file contents remain unverified until rechecked under the same permission
and size bounds. Age alone cannot prove that the document and checklist differ.

## Adopted bounded defaults

### Read-only plan change digests

`Store.changeDigest` owns a single read transaction; `shared/change-digest.ts`
owns pure validation, task classification, endpoint causes and bounded aggregation.
`GET /v1/change-digest` is capability-gated by `planChangeDigests:1` on ready
health responses. Its frozen wire types, fixture excerpt and error discipline
are in `docs/contracts.md`; types are re-exported through `shared/progress.ts`.

The transaction checks store identity, live existence/metadata and cleanup
generation, then validates the pinned target before any history scan. No baseline
means initial target-only counts. Otherwise a separate baseline lookup can supply
exact endpoint causes even if the intervening scan is partial. Starting at target,
point lookups walk backward one revision at a time; only validated adjacent pairs
produce events. Missing/invalid predecessors stop the contiguous suffix, never
bridge to the direct baseline. A suffix includes its predecessor before claiming
the first transition. Snapshot identity, safe revisions/structural metadata, ISO
timestamps, item IDs/kinds/statuses/titles/parents/dependencies, uniqueness and
structural cycles are validated; regressing chronology/structural metadata stops
comparison. Unknown history is explicitly qualified, not treated as no changes.

There are at most 128 interval snapshot slots plus one baseline lookup, sharing
8 MiB of actual snapshot input. SQL projects byte length and returns text only
when it fits the remaining budget, before JSON parsing. Baseline reuse does not
consume bytes twice. Live existence/cleanup metadata is a separate fixed lookup.
The scan keeps only endpoint and adjacent working snapshots, not a history array.
Up to 1,000 items per snapshot bound validation/comparison. Aggregation retains
the 50 most recently highlighted task identities, at most four references each,
while counting all proven events. Untracked omitted identities are an indicator,
not an invented distinct-task count. A final UTF-8 serialization cap removes
least-recent rows until the body fits 256 KiB; summary and qualification survive.
`work` counters make the input limits directly testable, not timing-dependent.

All operations use the existing connection/read transaction. Read-only Store
mode works without creating schema, cleanup state, receipts or checkpoints.
No source-document filesystem reads/capture, retained Store, service cache,
report operation, viewer table or migration exists. List polling does no digest
work. Archive/restore retain snapshots and baseline identity; delete invalidates
new reads. A reply captured before a concurrent write remains pinned; consumers
still retire it on authoritative identity/cleanup/lifecycle changes.

Focused verification (disposable synthetic SQLite/loopback HTTP fixtures):

```sh
node --experimental-strip-types --test tests/backend/change-digests.test.ts
node --experimental-strip-types --test tests/backend/change-digests-service.test.ts
node --experimental-strip-types --test tests/backend/change-digests-service.test.ts tests/backend/plan-cleanup.test.ts tests/backend/plan-cleanup-service.test.ts tests/backend/production-storage.test.ts tests/backend/task-timing.test.ts
```

Tests cover transient/reversed changes, independent endpoint scope causes,
same-status/replay suppression, staging, gaps/corruption/missing endpoints,
safe-integer parsing, input/output caps, SQL/source-byte immutability, cleanup
continuity, source isolation and a real independent WAL writer at a labelled read
transaction seam. The 1,000-item maximum-title history is a labelled direct SQL
fixture for budget verification, not a claim that any one report bypasses the
existing request/chunk limits. No wall-clock performance gate is used.

### Deliberately reported blockers

The additive blocker revision in `docs/contracts.md` extends schema2 JSON
snapshots only. `parseRequest` and the registered report schema accept optional
`blocker` on task items/changes; the real plugin executes the same parser and
transactional Store path. `BlockerRequest` names the additive request contract.
Only `category`, `reason`, `nextAction` are input content. Category is one of
decision/dependency/review/external/other; prose is nonblank, NUL-free and at most
512 JavaScript code units per field. Unknown keys and incompatible destinations
fail atomically. Change status remains required. Existing receipt, assignment,
source, count and lifecycle semantics remain authoritative.

`Store.apply` first checks inherited annotation shape and validity against the
previous revision, before advancing it. It retains only verified-current details
on a continuously blocked task, applies explicit complete replacements/null
clearing, then advances retained/new validity markers at commit. Server-only
provenance preserves the actual annotation author, attributed session, mode,
report revision and ISO timestamp. Status-only relay does not re-author retained
text. Structural annotations are authored at commit, never staging. Leaving
blocked, task-kind/removal/re-entry boundaries and closing/reopening clear
inherited details. Explicit newly reported details can populate a reopened task.
Failed validation, conflict, incomplete commit and replay expose no partial state.

An unmodified older writer may carry unknown fields without advancing their
validity marker, or discard them during structural replacement. The new writer
never recertifies stale inherited data; deliberate re-reporting is required.
`Store.detail` independently projects only valid blocked-task annotations, both
for service pages and explicit-page tool reads, without rewriting snapshots.
Malformed optional data (including unknown future categories) cannot certify a
known annotation and is omitted; consumers label its parts unknown/unavailable,
not success. Raw internal `Store.get` is not a safe public projection. The UI
adapter must also validate markers because an older service may expose raw fields.
There is no new table, migration, forced upgrade or history repair.

`service/blocked-timing.ts` separately derives response-only `blockedTiming` on
authenticated `GET /v1/plan`. One finite transaction on the existing Store
connection checks store identity, the pinned detail revision, cleanup generation,
full current snapshot and page agreement. Shared snapshot validation checks
bounded unique items, references/cycles, identity, lifecycle and timestamps. A
reverse point-lookup scan accepts at most128 snapshots/8MiB of text and emits at
most1000 task entries across the whole plan. SQL tests byte length and returns
NULL for over-budget text **before** materialization in JavaScript. No per-task
history scan, retained handle/cache, list/history-route scan or backfill exists.

Exact blocked starts require creation or a proven nonblocked/absent/non-task/
closed boundary. Repeated/relay/neutral reports and reason-only edits do not reset;
unblock/reblock and close/reopen do. Valid capped suffixes are lower bounds;
gaps, corrupt/future/regressing history and mismatched identity produce unknown,
not zero. Timing is status-history evidence, not certification of annotation
text, real-world waiting or model activity. `readAt` is a fresh server anchor;
the consumer advances it from monotonic receipt time on its existing ticker.
Store/tool reads do not add timing. Working `timing` remains independent and its
interval semantics are unchanged; its text admission is also SQL-bounded. The
combined timing ceiling is256 snapshot visits/16MiB admitted text per detail.
The existing1MiB complete response ceiling still applies. Consumers must restart
detail traversal on progress **or cleanup-generation** changes between pages.

Focused backend proof uses disposable SQLite stores, synthetic authoritative tool
callers, controlled clocks and authenticated loopback HTTP:

```sh
node --experimental-strip-types --test tests/backend/needs-you.test.ts tests/backend/progress-invocation.test.ts tests/backend/production-contract.test.ts
node --experimental-strip-types --test tests/backend/needs-you-service.test.ts tests/backend/production-storage.test.ts tests/backend/plan-cleanup.test.ts tests/backend/plan-cleanup-service.test.ts
node --experimental-strip-types --test tests/backend/needs-you-timing.test.ts tests/backend/task-timing.test.ts
```

The compatibility test extracts the complete shared source projection from pinned
pre-feature commit `4f582b7f3404088d01531598102833000c23cd87`, verifies extracted
bytes and loads that **unmodified** Store separately. It exercises older unrelated,
status and structural mutations plus unblock/reblock after annotations exist,
then proves newer neutral writes cannot revive them. Old schema2 reports remain
readable without rewriting snapshots/schema. Independent cleanup tests cover
archive/restore/delete and concurrent writers; timing tests directly measure
SQL admission, capped scans, current mismatches and the1000-task ceiling.

`tests/fixtures/needs-you.ts` launches a source service, or the built service with
`--built`, on disposable roots only. Its readiness line includes a fixture-only
transport credential; never save that credential in evidence. P-attention has
all five categories, missing parts, literal HTML-looking prose, group/skipped/
prerequisite rows, explicit child C participation and enough items/contributions
to paginate. Same-ID work in another source/plan stays isolated. P-lower and
P-unknown provide capped and gapped timing examples; their controlled timestamps
and history are fixture-only seeding, not production read behavior. P-finished
is eligible for explicit cleanup checks. SIGTERM/SIGINT disposes the service and
temporary data. No real installation/profile or source documents are involved.
Sanitized local proof: `evidence/needs-you/` (backend, API, compatibility, timing).
This does not replace browser/native-host or final built-artifact acceptance.

### Existing production limits

-16KiB report/setup bodies;262144-byte full document cap, strict UTF-8, no binary.
-20 default read rows,50 max plan-list/history rows; document pages16384 Unicode
  code points, immutable capture ID continuation;1MiB response ceiling (413 rather
  than truncation). Selected-detail continuation must restart on revision change.
-50 items/chunk,32 chunks/upload,1000 items/plan; effective aggregate also bounded
  by per-request size. Reject oversized structure; no partial commit labeled full.
- titles256 plan/512 item characters; IDs80;16 dependencies/item;64 child links.
-1s SQLite busy timeout;5s HTTP headers/request timeout; no endless retry.
- mode0700 dedicated store/payload/package directories,0600 DB/descriptors/files
  and SQLite journal. Corrupt/unsupported files are diagnosed and preserved.

These defaults are implementation bounds, not new estimates/stuck thresholds.
Routine status targets250-token requests/100-token receipts are character-based
tuning estimates only; see evidence/backend/token-budget.md. No extra LLM calls.

Activation keeps at most128 pending source/session flags and256 recent qualifying
source/session/message/call IDs per loaded instance; host IDs are bounded512
characters and lexical path metadata4096. Only native2.1.4 successful single-file
`write`/`edit` operations on conventional plan paths qualify. No document paths,
bodies/diffs, plan/receipt state or inferred progress are retained. A hint is
conditional and consumed on its next eligible delivery, independent of receipts.
Each event flags the writer and at most its verified direct parent (two keys),
published together after disable/disposal/duplicate checks. Parent lookup errors
preserve the writer hint and unrelated pending flags. Each recipient's own
eligibility gates delivery/consumption: a restricted child's context cannot
consume its parent's flag, and a restricted parent gets no fallback relay.
Hints mention a possible delegated child, never paths, names or assignments.
The same bounded recipient map coalesces plan-write, dispatch and tracker reason
bits into one conditional hint. Proxy reasons target only the actor, never a child
or parent; only qualifying plan writes retain the direct-parent relay. The existing
128-recipient/256-call caps, one-shot next-context consumption and synchronous
duplicate/disable/disposal checks apply to all reasons, with no extra queues,
per-tool history or progress lookup. A shared inner/outer Code Mode call identity
may conservatively lose a second reason rather than create more history.

Dispatch accepts only exact `subagent` completed events with typed native input,
bounded returned child session ID, running/completed status and string output.
Tracker accepts only exact `linear_save_issue` / `linear_save_comment` completed
events with the full observed typed issue/comment success metadata in parsed
`result.output`, excluding error/partial indicators. Returned identifiers alone,
strings, wrappers and input-supplied identifiers are insufficient. Metadata types
are checked without interpreting prompt, body, title, worker text or state names
as progress. Hook execution never invokes a report, scans a plan or reads a document.

The tracker envelope is pinned to observed official remote-server behavior on
2026-10-30 and native 2.2.2 normalization, not a universal connector contract.
Issue metadata requires returned identifier/UUID, typed timestamps/status/priority,
labels and team/author/link metadata; comments require UUID, timestamps, attachments,
typed body and author. Required fields are non-null; supplied nullable lifecycle/
context fields must retain their observed types. Unknown aliases, missing/mistyped
metadata and unfamiliar/version-drift shapes remain silent. Native structuredContent
and schema-less JSON text can normalize identically; recognition is origin-agnostic
on the typed parsed object. JSON text with a declared output schema may stay a
string and silently lose coverage; there is no plugin-side text-parsing fallback.
Native Code Mode inner calls qualify by exact hook name, never by wrapper text.
These observations are advisory, not receipts, assignments, canonical milestones
or accepted completion; delivery and model compliance remain separate claims.
Restart/cap eviction may lose a hint or permit an old replay; base guidance recurs.
Observed disable drops pending hints and invalidates in-flight lookups, with no
backfill on re-enable. Disposal clears local state before unregistering hooks and
closing Store; setup failures roll back partial registrations and close Store.
No persistent reminder, new RPC or automatic progress/capture write exists.

Progress resume separately retains at most128 session compaction records and256
event identities, never plan titles/revisions/assignments between requests. It
pairs a validated start, observe-only compaction hook and increasing matching-reason
end independently of hook/start callback delivery order. One constant-size hook
window and open start share each record with sequence/retirement metadata; orphan
hooks and primary tombstones share the same cap. No common attempt ID is exposed
by the inspected hook/event surfaces. The conservative temporal fallback requires
`start.created < firstHookTime <= lastHookTime < end.created`; timestamps reject
ambiguous evidence, not establish authority or a unique attempt identity. Boundary
ties, backward/inconsistent clocks, stale hooks and overlapping starts decline.
Both start→hook→end and hook→delivered-start→end can qualify; arbitrary inversions
of the durable stream and background/precomputed compactions are not certified.
Terminals retire the window; failures clear pending state. The first following
primary consumes pending and incomplete evidence before awaits, preserving a
creation-time retirement fence against delayed stream backfill. Eviction, floor
rejection and lifecycle clearing promote removed records' fences into the global
event floor, even after clock rollback, conservatively declining older queued
episodes. There is no
per-turn recovery scan, new timer/persistence or automatic retry/backfill. Observation
does not read summaries or alter the host's compaction system/messages/options,
tools or result. Generic guidance/file hints remain independent.

Capsule authority reuses the authoritative32-hop ancestry path with cancellation
checkpoints before/after each await and a one-second capsule-only deadline. A
request-scoped timer is cleared after use; there is no poller. Only one recovery
identity lookup can be outstanding, including a host call ignoring cancellation;
retired work cannot take another hop or inject late text. After identity, the
synchronous bounded Store read and append introduce no further application await.
Current control, binding and effective tool gates are rechecked at use. Observed
disable/source/store-generation changes and disposal retire pending/held state;
off/on transitions entirely between observations are not losslessly detected.

The internal projection checks expected store/source binding, enabled control,
active lifecycle, coordinator or current explicit assigned-child authority, and
cleanup in the same read transaction. It admits64 source-plan slots,1MiB per
snapshot and8MiB total JSON before materialization; validates1000 items/64 links;
and checks a cooperative100ms scan budget between bounded steps. SQLite busy
waits remain bounded to1s; this is not a hard100ms total-latency guarantee. No
history/contribution/document/source-root inventory, broad list/detail envelope,
schema/index change, persistent cache or new connection is involved.

Rendering is at most3 candidates/4096 UTF-8 bytes, with whole-candidate omissions
and explicitly unconfirmed partial coverage. A child receives at most20 complete
assigned IDs per candidate, never task prose or sibling scope. The exact internal
DTO, active-only eligibility, read-before-mutation instructions and generic
fallback are frozen in [the contract](contracts.md#advisory-activation-does-not-change-the-protocol).

Native guidance, inline/packaged skills and an early report-description clause
distinguish tracker updates from reports and conditionally identify PLAN_READY,
review approval, owner approval and actual work start as meaningful unreported
canonical boundaries. The plugin detects none of those states. Ready is not
review/approval/completion; dispatch is not work start; existing canonical gate/work
items are mirrored without inventing review tasks. Already-current state needs no
mutation, and no file or automatic per-turn report is required. Description-only
client exposure and model compliance remain outside native delivery guarantees.

## Verification and known limits

### Compaction-only progress resume

Portable Store/installed-adapter checks (Node24.19.0, existing dependencies):

```sh
node --experimental-strip-types --test tests/backend/progress-resume-store.test.ts tests/backend/progress-resume-activation.test.ts tests/backend/production-contract.test.ts tests/backend/progress-activation-contract.test.ts
bun run typecheck
```

The separately selected native `progress resume` case on OpenCode **2.2.2** loads the real production
plugin with direct synthetic Store seeding, not an installer. It captures actual
outgoing recovery from system parts with a credential-free scripted AISDK provider,
fresh HOME/XDG and a rootless loopback-only network namespace. Source and built
commands are in [compatibility](compatibility.md#progress-resume-capsule-verification).
Proof includes a changed current revision, unconfirmed candidates, assigned child,
unlinked/restricted child, finished-only work, failed/empty compaction, disable,
archive/delete before delivery, and real native plugin reload. No observer emits
recovery in regression mode; the provider does not choose or execute report tools.

The plugin/client adapter remains pinned **2.1.4**, separate from the host pin.
Source-built and verbatim emitted-companion native runs pass all21 existing
resume scenarios, including `unique-current-r2` and one-shot consumption. Focused
A2 activation also passes on2.2.2. Local evidence is under
`evidence/resume-capsule-host-ordering/`. Earlier2.1.4 success remains historical,
not a fresh rerun. Tagged [host compaction](https://github.com/anomalyco/opencode/blob/v2.2.2/packages/core/src/session/compaction.ts)
and [hook types](https://github.com/anomalyco/opencode/blob/v2.2.2/packages/plugin/src/effect/session.ts)
explain the inspected surfaces; no cross-surface delivery-order guarantee is assumed.

The pinned adapter subscribes in-process, not through an HTTP event
connection. Its event stream is explicitly volatile/live-only without replay
controls. Host replay therefore remains unexercised, not passed; duplicate and
sequence guards are covered by unit tests. Actual plugin reload proves that old
completion does not re-arm and a fresh successful compaction still delivers.
Manual compactions were triggered; automatic reasons are unit-covered only.
This integration proof does not establish model compliance, desktop-native
OpenChamber/AppImage behavior, or cross-version support. Historical checks below
are not recertified by these runs.

Portable CI/package checks are separate from native-host certification. The full
`bun run check` aggregate is **blocked/not green** by an independent native
subagent/desktop family outside this capsule fix. Passing focused and portable
checks do not waive or certify that family, installation or a release.

### Official-main metadata checker

`service/extension-updates.ts` owns one in-memory checker/cache per service
generation. `GET /v1/extension-update` runs behind existing bearer validation and
before SetupController/store lookup, so unconfigured/failed capture is independent.
It requests exactly GitHub Contents
`https://api.github.com/repos/Phototonic/openchamber-progress/contents/package.json?ref=main`
with raw-file Accept, fixed User-Agent, omitted credentials and manual redirects.
No auth/cookie/header forwarding, environment/feed override, guest URL/ref, private
host API, installer, artifact download or GitHub Release lookup exists.

The existing SDK parseManifestJson validates the manifest, followed by expected
panel identity agent-progress-probe, declared panel/page/status/service and strict
semver validation. SDK shorthand page/status declarations remain valid. Numeric
components and prerelease identifiers use SemVer ordering; build metadata is
neutral. Only a higher official-main version is available. This is a metadata
advertisement, not verification of runtime artifacts or actual install provenance.
The separate pre-main artifact/host gates must reject a manifest-only release.

One shared in-flight request,5s full header/body deadline,64KiB accepted response,
1h success TTL,5min failure cooldown with longer valid Retry-After/rate-reset
deadlines. Conditional ETag requests use only bounded validated header text and
matching cached manifest knowledge. A304 without that knowledge (or with a
contradictory ETag) fails unknown/stale, never fabricates success. Failures retain
validated candidate/state and last success with stale=true. All diagnostics are
fixed strings; raw upstream bodies/errors are never returned or logged. No disk
cache. Service close aborts owned outbound HTTP before waiting for request drain;
timeout and shutdown clear the bounded timer. There is no background daemon or
check when no frame asks. Internal constructor transport/clock/timeout seams are
only test construction, not production HTTP/environment configuration.

Frozen DTO/lifecycle meaning: docs/contracts.md. Focused metadata checks:

```sh
bun run typecheck
node --experimental-strip-types --test tests/backend/extension-updates.test.ts
```

Tests use real authenticated service HTTP plus real loopback metadata HTTP, with
logical fixed-target assertions and no live GitHub/private authentication. They
cover coalescing/cache/ETag/provider failure, validation/semver, bounded redirects/
body/deadline/shutdown, store independence and unchanged fixture selection/config/
DB bytes. Local evidence: evidence/release-checks-live-status/updates-http.txt.
An ignored runnable loopback-only fixture includes companion/setup siblings for UI
integration. No current installed companion or real setup roots are touched.
Final stable-input package/Git-distribution checks are separate validation.

### Reported-working interval reader

`service/task-timing.ts` derives optional detail timing from immutable v2 revision
snapshots after `Store.detail()` completes its own transaction. One prepared reverse
scan is pinned to that detail's source, plan and revision, in a separate compact
read transaction on the existing Store DB. The current snapshot must agree with
the detail lifecycle, report timestamp, working IDs and paged item kind/status.
Later committed revisions cannot alter this derivation. No parallel connection,
capture mutation, stored timing, schema migration, backfill or tool-output expansion
is added. Authentication, source binding and the response-size ceiling are retained.

Bounds: at most128 snapshots and8MiB of snapshot text accepted for parsing per
detail read, serving all working tasks/pages in one scan. A valid truncated suffix
is explicitly a lower bound; missing current/gapped/invalid/future/reversed history
is unknown. A snapshot that crosses the byte budget is not parsed. Cost is linear
in accepted snapshot bytes/items, not a separate history query per task. There is
no history work on the plan-list polling route. No derived cache is justified:
detail loads are revision-driven and this finite scan is adequate, while a cache
would add replacement/identity invalidation and retention complexity. Every reply
gets a fresh server readAt. No Store, DB handle, prepared statement or cached reply
is retained across reads, preserving SetupController close/reopen/recovery.

The frozen optional DTO and browser monotonic-clock/lower-bound rules are in
docs/contracts.md. It describes continuous **reported** working, never live model
execution. Legacy v2 snapshots need no timing field. Malformed optional history
does not break an otherwise valid detail response or rewrite stored bytes.

Timing checks (Node24 available through the local version-manager bin directory):

```sh
bun run typecheck
node --experimental-strip-types --test tests/backend/task-timing.test.ts tests/backend/production-service.test.ts tests/backend/production-storage.test.ts
```

These checks use actual Store writes, a controlled clock, authenticated HTTP,
replay, neutral link/relay/structure changes, reset boundaries, cap/byte-budget and
isolated corrupt snapshots, paging/concurrent commits, store/source isolation and
closed-handle recovery. Evidence: evidence/release-checks-live-status/timing.txt.
The ignored isolated service fixture includes copied companion/setup siblings.
This is not final package/distribution or browser validation; those require a
stable-input build and companion byte-identity check.

### Companion comparison / frozen setup UI seam

`SetupRead.update?: CompanionUpdateRead` is additive on existing setup status
reads and mutating action replies (see docs/contracts.md). SetupController uses
its trusted `readonlyPayload` injection only with an available store and verified
source. Lifecycle inspection first validates owned root/release bytes, then uses
the same release derivation as install/update: existing binding with candidate
version plus plugin/guidance hashes. No version-only “current” claim is made.
Semver comparison distinguishes equal-version rebuilds, upgrades and explicitly
newer-installed selections, including numeric components and prerelease ordering.

Selected version remains manifest-authoritative. Verified root package version is
diagnostic metadata and can lag because update retains the initial root files.
Unknown/unconfigured/removed/unverified/modified/store-error states omit comparison.
Activation remains independent, with no loaded-version fabrication or live census.
No new cache, progress-poll audit, database migration, route or request body is
introduced. Full fail-closed mutation revalidation is unchanged.

Real HTTP regressions in tests/backend/service-lifecycle.test.ts cover current,
upgrade, same-version changed bytes, newer-installed/downgrade, retained root bytes,
post-update pending/matching observed activation, uncertainty/absence and modified
update refusal with retained history. Local evidence: evidence/upgrade-ux/backend.txt.
The real-service fixture includes companion and setup siblings, not just the
read-only service. These checks are not package/release validation. Reported real
use of0.2.4 had no issues, without establishing the earlier slowdown's cause.
No real-user operation is part of these fixture checks.

### Host-side setup suggestions / frozen setup UI seam

`shared/progress.ts` adds Suggestion/SetupSuggestions and optional
SetupRead.suggestions, populated only by existing GET /v1/setup while unconfigured
on Linux or supported Windows. `service/suggestions.ts` reads only allowlisted host HOME/XDG config/data
hints, validates their absolute canonical spelling and directly observes the two
candidate roots. It uses no cwd/binary/project inference, home-account lookup,
recursive search, file-content/config/auth reads or CLI subprocess. The trusted
HostPathContext test seam is internal constructor input, never a request option.

Resolved = observed owned directory with no alias; candidate = honest default;
null = unknown. No state claims effective OpenCode source identity. A filtered-out
override cannot be ruled out from environment absence. Store suggestion is exactly
dataRoot/openchamber-progress with inherited data provenance, without probing the
child. GET hints never set verified/targets/binding and never persist a selection.
Configured bindings (including unavailable stores) omit suggestions; POST replies
and bodies remain unchanged. Read-only setup-target semantics exclude only the
already-existing service-private selector bootstrap. No service reuse or payload
cache was introduced. See docs/contracts.md for the frozen field names and UI
edit-preservation precedence.

Suggestion checks run real authenticated HTTP with fixture HOME/custom XDG, missing/partial/
invalid hints, unsupported host, symlink/foreign-UID/non-directory candidates,
permissive store and configured binding. It checks fixture bytes/mtime unchanged
on GET/inspect and verifies discovery reads no contents or child-store metadata.
Foreign UID is scoped stat injection, not privileged chown. A separately compiled
service smoke test uses a fresh allowlisted HOME with a different cwd and no model.
The existing21 setup regressions are retained, including all7 normalization tests.
No actual installed invocation is claimed as diagnosed by those fixtures.

Source-only command/evidence:

```sh
node --test tests/backend/setup-suggestions.test.ts tests/backend/setup-paths.test.ts tests/backend/production-setup.test.ts tests/backend/production-service.test.ts tests/backend/service-recovery.test.ts tests/backend/service-lifecycle.test.ts
```

Local evidence is under evidence/backend/setup-suggestions* (ignored, not shipped).
UI integration uses a separately built service fixture; packaging is validated
separately. The suggestions API did not change the release version or protocol/schema.

Contract tests cover fixture P1/P2/P3, relay counts, atomic invalid batches,
conflicts/replays, assignment/closed/reopen/finish variants, move history, chunks,
pagination, Unicode document/version capture and denied/moved/oversized reads.
Storage checks use actual production writer processes, trigger pause inside write transaction,
SIGKILL before commit and after commit-before-reply, bounded busy, SQLite page
capacity/read-only write failure, corrupt/future files preserved. Capacity fault
is a real SQLite storage failure, not a full filesystem exhaustion experiment.
Setup checks use real HTTP and disposable setup roots, update interruption, modified files,
symlink/collision refusal, transactional control and history-retaining removal.
The self-contained production companion activates/updates in an EMPTY isolated
OpenCode2.1.4; standalone removal utility controls that loaded instance after
extension absence. No credentials, inference or real-user installation.

The initial backend unit/integration tests did not establish real OpenChamber
production-frame/service integration. Earlier desktop host SQLite evidence is
retained. Slim/model relay/title/generate/wire fallback limitations of the initial
probe remain explicit. Initial backend validation excluded ZIP/folder assembly;
subsequent package validation is recorded below.

## Initial recovery follow-up and 0.2.0 artifacts

Following the initial backend validation, service recovery and local package
assembly were added:

- SetupController retains a validated descriptor independently from store open
  failures. Descriptor collisions still fail closed; store failures no longer
  masquerade as missing configuration. Each health/setup/read reopens and validates
  once, with the existing SQLite busy bound; no retry loop or recovery mutation.
- Health returns503 for a failed configured store. Setup retains configured=true,
  resolved roots and the fixed store diagnostic, with captureEnabled=null.
- Reload-required is conservatively recomputed from a verified installed payload
  after restart; no descriptor or frozen DTO shape changed. A service restart or
  successful capture control is not proof that a host reloaded the selected code.
- scripts/package.ts assembles the extension/companion folders and ZIPs from built
  backend outputs and unchanged guest artifacts. Package metadata0.2.0
  agrees with production payload/status version; protocol/schema are2.
- scripts/verify-package.ts exercises the extracted companion setup utility,
  actual packaged tool with synthetic SDK callers, loaded disable/enable, retained
  history, separate removal and packaged service HTTP. An optional explicit host
  module additionally runs the actual host folder/ZIP installer in isolated
  registries. No host app, browser, model or real-user installation is involved.

Artifacts/inventory: build/artifacts/. Documentation: docs/setup.md. Regression
tests: tests/backend/service-recovery.test.ts. Check logs, acceptance limits and
hashes: evidence/backend/qa.md and its follow-up addendum. The optional actual-host
gate is required for this handoff and was run; it is not silently claimed by a
normal check that prints actualHostInstaller=not-run. At this historical stage,
final runtime/relay validation had not yet run.

## Backend corrections /0.2.1 (supersedes prior default/reload behavior)

- Default service selection is now product-owned state OUTSIDE the replaceable
  extension directory: XDG_STATE_HOME/agent-progress-service, or the product's
  HOME/.local/state fallback. This is not source/host-config discovery. The host
  exposes no stable OpenChamber data-directory variable to services, so we do not
  guess its custom root. The private state scope has one selected binding;
  isolated hosts inherit distinct HOME/XDG scopes. Ownership, descriptor hash
  checks and symlink refusals remain fail-closed. Explicit direct-service binding
  overrides still work. A legacy package copy is only an initial migration input.
- Producer setup records the most recently loaded source/install fingerprint only
  AFTER tool/skill/RPC registration succeeds. It includes binding/version and
  actual plugin/guidance hashes. The optional loaded_activation table is additive
  internal metadata in an existing v2 store, not a migration or wire DTO change.
  Old v2 readers remain usable; an old producer has no observation until updated.
- Setup compares the verified selected payload with that latest observation.
  Pending reload is durable across service restart, clears after the selected
  tool loaded, and returns on same-version byte changes, superseding updates or
  rollback after a different load. No live process census or automatic restart is
  claimed. Existing activation strings are reused; there is no new UI mapping.
- Shared-store payload diagnostics compare source roots, so a new second source
  does not mislabel the first source's immutable releases as unused. Existing
  unreferenced-payloads-retained remains for actual same-source unreferenced data.
- Package release0.2.1 distinguishes the changed companion/service pair from the
  accepted0.2.0 live proof. Protocol/schema2 and tool/report/read shapes remain
  frozen. shared/release.ts drives packaged versions; root metadata is verified.

Regression tests: tests/backend/service-lifecycle.test.ts, plus the actual EMPTY
OpenCode runtime test's pending/loaded/update/reloaded observations. Artifact QA
also replaces the entire packaged extension directory, then proves configured
views/store identity and unreadable-store recovery through real HTTP. Entry
inventory equality is required across assembly; ZIP container byte equality is
not (timestamps/headers are not canonical). UI bundles are copied unchanged.
The original live2 proof applies to the corrected0.2.0 build label; no new model run was performed or claimed.
Evidence and migration limits: evidence/backend/qa.md and docs/setup.md.

## Historical 0.2.3 package validation

Extension/companion metadata moves together to0.2.3; protocol/schema remain2.
Backend outputs include the preserved separator normalization, read-only
suggestions and deterministic Store cleanup on failed plugin setup. The plugin
retains its normal success disposer and original setup errors. The smaller-import
candidate was not promoted; persistent-service Store reuse and payload caches
remain deliberately absent. Accepted guest bundles are copied
byte-for-byte, never rebuilt by backend packaging.

`scripts/verify-package.ts` checks canonical entry inventories, exact folder/ZIP
allowlists, manifest/version agreement, the actual packaged unconfigured service's
suggestions and read-only inspect, installed tool/guidance, lifecycle/history,
stable selector replacement and unavailable-store recovery. The actual host
installer gate uses the explicitly supplied isolated host module and installs the
folder and ZIP into fresh registries, not a real app/configuration.

The separate `scripts/verify-source-package.ts` copies git-visible source into a
new temporary tree without generated backend output, local-only ignored directories
or node_modules; only an explicit symlink to existing dependencies is provided.
It runs typecheck and the
backend build, not a second full test/aggregate suite. This proves no local
evidence/generated-backend dependency for that path, not a fresh dependency install
or the later git-archive/clone gate. No network fetch is required.

Local QA: evidence/package/m2-checks.txt, source-export.txt and canonical entry/hash
inventories; backend acceptance limits remain in evidence/backend/qa.md. Cached
revisit/spinner and bounded latest-switch refresh fixes have browser regression
evidence; failed-setup connection cleanup has focused runtime regressions. None
establishes the reported hours-long real-host sluggishness cause. This historical
0.2.3 candidate validation did not establish a complete performance cure.

## Companion upgrade UX / historical 0.2.4 package validation

Extension/companion metadata moves together to0.2.4; protocol/schema remain2.
The accepted update-detection service and guest bytes are joined without rebuilding
guests. The package gate additionally exercises older-fixture detection, explicit
confirmed update, current selection with reload pending, and matching loaded
observation through the exact packaged service over HTTP. Production lifecycle
fixtures create owned state; no test Store rows are handwritten. Root utility
metadata and history are retained; modified payloads and corrupt ownership refuse
updates and make no comparison claim. Both ZIPs are extracted and every declared
file is compared to its assembled folder. Local evidence:
`evidence/upgrade-ux/package.txt`. The historical real0.2.3 update remains separate;
these checks did not include a real0.2.4 install/reload or establish a new performance claim.
## Declared delegation correlation

`plugin/delegation.ts` owns one hook pair and event subscription, forwarding
allowlisted run observations to its focused helper. Declarations now persist in
the same Store and existing plan receipts. There is one pending/reserved intent
per source/parent, with no TTL or restart re-arming. Database admission order
reserves the first supported dispatch; result arrival order cannot steal it.
Second nonempty declarations conflict; explicit cancellation precedes replacement.

Structured returned identity and complete native same-source/project/location
immediate-child ancestry are required. Unsupported aliases and text results do
not bind. The old message-wide one-call census/step fence is superseded. Native
execution evidence remains a separate run fact, never assignment authority.
Failed/unconfirmed reserved calls retire intent. A native failed/interrupted
parent also retires pending call authority without asserting child failure;
later proven child metadata may still enrich the retained row, not its assignment.

All asynchronous identity work occurs outside transactions, with one-second
guards and physical occupancy retained when a host ignores cancellation.
Binding rechecks generation, plan visibility/lifecycle, original revision and
task availability. `Store.applyMutation` is the existing private mutation owner;
an internal savepoint commits link/provenance and durable disposition in the same
transaction, or records a fixed refusal without losing the dispatch observation.
Assignment is unioned with the child's current IDs. Status/reporters/counts/report
time remain unchanged; explicit `link` and restricted-child task relay are intact.
Capture toggles and plan closure/deletion fence intent even under old writers.
Partial registrations dispose safely, and late disposed lookups cannot publish.

Durable intent persists caller source/session IDs only. Binding resolves those
IDs through the existing `sessions` identity owner populated by native capture;
it does not retain another Actor/directory snapshot. Declining an after-hook at
the lookup cap still transactionally records an unconfirmed disposition and
retires its reservation, so restart cannot strand next-dispatch authority.

Run capture may add verified native session identity to that existing identity
owner; such metadata is not a progress report. It cannot replace an existing
reported identity or populate a missing identity already referenced as a plan
coordinator, linked participant or attributed contributor. This matters because
directory-filtered plan lists join `sessions`: passive metadata must not change
plan visibility, summaries, detail, items, history, receipts or contributions.
Only explicit reporting may update those progress identities. The native proxy
fixture compares every non-run table exactly except for precisely verified new
dispatch identities, and checks nonempty list/detail/history views before/after,
including directory and unassigned-child membership filters.

## Sub-agent run read seam

`shared/subagent-runs.ts` owns the revision-1 DTO, bounds, validated additive
schema and SQL projections. `Store` wraps every run mutation in its existing
`BEGIN IMMEDIATE` owner, with the same SQLite busy handling and no awaits inside
transactions. Extension initialization is explicit companion activation only;
read-only opens, GETs and `/health` do not initialize it. Exact schema validation
rejects incomplete, foreign and future extensions. The base user version stays 2.

`plugin/subagent-runs.ts` is a focused observer called by the existing delegation
before/after hooks and event subscription. Before capture stores only dispatch
IDs, dispatch time, allowlisted child-agent/description and unambiguous current
plan context. Inherited context uses the same cleanup-state eligibility as direct context:
archived/deleted plans are excluded, but a restored `visible` record does not
exclude an explicitly reopened active plan.
Parent/child identity is native, same-source/project/location and
complete-ancestry checked. Identity work is outside transactions; ignored aborts
retain physical lookup occupancy. Passive failures qualify capture loss and do
not abort or modify native execution. After hooks never insert a missing dispatch.
Native execution observations retain only the latest bounded interval candidate
per child; this permits a terminal event before verified after-hook attachment.
Verified root identities (explicit null parent and empty verified ancestry) are
not staged as child execution candidates. Root failure/interruption still retires
pending dispatch authority. At the 256-candidate cap, admission prefers these
unprotected victims in order: verified roots, candidates whose terminal event is
older than the five-minute adoption window, then the oldest remaining candidate.
The first two classes are reclaimed silently; the last records possible capture
loss. Candidates referenced by an unresolved verified dispatch remain protected;
if every slot is protected, the new observation is declined with loss.

The five-minute window is measured from the stored terminal event to an incoming
event from the same source, using native host timestamps, not wall-clock receipt
age. Out-of-order/older incoming events cannot age candidates forward; another
source's clock cannot expire them. A terminal exactly five minutes old remains
eligible. Start-only candidates never silently expire: a foreground child can
run for hours. Unknown identity alone is not proof of a root.

Foreground subagent calls return when the child ends; background calls return at
dispatch. The registered after hook starts child-identity resolution immediately,
with a one-second identity guard, then attaches/adopts in the Store. Existing
native and controlled regressions establish terminal-before-after ordering. Five
minutes is a generous bounded allowance for that terminal/after-hook race, not
a claim that the host guarantees a delivery deadline. Under capacity pressure,
unassociated completed intervals outside this window may be discarded rather
than treated as lost runs; a callback delayed beyond the allowance may therefore
remain unknown. This bounds staging for ordinary completed, unreported sessions
without falsely latching capture loss, while preserving fresh terminal races,
long-running starts and unresolved verified dispatches across restart.
A proven start must follow dispatch and a unique child interval must exist.
Pending childless calls compete only when admitted at or before an unassociated
candidate's start. Once that start is proven for a dispatch, a later pending call
cannot prevent its matching terminal event from completing the execution; no
callback from the later call is required. Same-child execution ambiguity checks
remain independent.
Historical session summaries are not competing dispatches. They remain separate
history (and in historical/state counts and normal eviction protection); a later
proven execution does not certify or replace an unknown earlier session summary.
No prompt/result text or raw error/event is serialized. The ordinary report,
link and task-status paths remain independent.

`GET /v1/subagent-runs` is side-effect free. Authenticated reconciliation POSTs
create/coalesce finite source/root demand in the same database. A single unref'd
3-second companion timer checks this queue (no empty-queue host scan). The
companion verifies root/location before a transactional claim, then calls only
native session get/list outside transactions. List-by-parent traversal uses
exact links, cycle/depth/page/call/record/cooperative-time limits. Commit rechecks
request claim and persistent capture generation. A disabled capture interval
invalidates outstanding publication even if subsequently re-enabled. Ordinary
reads and duplicate settled requests neither re-backfill nor re-stamp records.
No service or guest native host credentials, session proxy or transcript API is
introduced. Stored facts stay readable with capture disabled or companion absent.
Plan-scoped accepted-task projection reads only task identity/status/assignee and
link facts, not blocker details or the full stored plan. Valid snapshots may grow
beyond 1 MiB through bounded writes; that response limit is not a stored-plan
size invariant. The existing 1,000-item/64-link structural bounds and run DTO,
accepted-item and response bounds still apply.

The read-seam tests use a real SQLite store and authenticated HTTP server with
the actual delegation registration and controlled native metadata replies.
They are portable evidence, not native-runtime certification. The separate
source/built native fixture records which host boundaries were actually exercised.
An explicit backend-only fixture mode omits UI/browser work, never certifying it.

The report router accepts a plan-free optional `handoff` only from its actual
native child caller. It validates a safe authored one-line summary, server-stamps
the time, stages unknown execution association separately and attaches on unique
interval evidence. Retries and conflicts do not advance task progress.
Closing an interval revalidates an already attached report: one outside the proven
start/end bounds returns atomically to session-only staging, preserving its authored
fields and operation identity for retry or later resumed-execution association.
Valid attached claims are not overwritten by other staged reports. Host terminal
facts take priority: if claim staging or total storage has no spare capacity, or
the unknown-execution slot conflicts, the invalid claim is detached and dropped
with `capture.loss` disclosed. The terminal still applies; capture stays enabled
and available. Restaging never prunes host runs to retain the lower-priority claim.
Current explicit task facts are projected into `accepted` at read time, bounded by row
bytes with an omitted-item count. Plan changes invalidate run-page cursors through
the monotonic run revision; stale stored acceptance is not resurrected.

Terminal-first retention uses the same transaction owner. Protected active state
is never evicted to admit new metadata. Unknown historical metadata is protected,
and the last retained ancestry edge to retained descendants is not a pruning
candidate. No parallel lineage archive is introduced. Pruned authored claims leave bounded
receipt fences counted in the total budget; replay cannot recreate history.
Historical continuation queues persist across companion reload and consume the
same bounded bookkeeping budget. A producer lease qualifies restart recovery,
not activity liveness. The timer performs no native scan for an empty queue;
ignored cancellation still occupies a physical host slot until settlement.
