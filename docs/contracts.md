# Production contract v2

## Reporting health observations

Setup replies optionally include `reportingIdentity: {storeId, sourceId, verified}` only after the configured store opens and its binding is verified. Unconfigured, unavailable-store and target-inspection replies omit it. This additive metadata does not change protocol/schema versions or grant authority to mutate. Guests must match it to the viewer store and source binding before joining installation/activation observations with a selected report; absent or mismatched identity means the association is unknown.

The board's explicit reporting check performs one setup GET and at most one first-page selected-plan GET, without following cursors. A stored revision is evidence of recorded progress, not independent receipt verification, recent agent activity, tool availability or completion. No selection means no selected report checked; filtered or incomplete history never proves no reports exist. No new polling, endpoint, report write or model call is involved.

Support text reconstructs fixed status fields and a bounded numeric version only. Paths, source/store/plan/session identifiers, timestamps, fingerprints, user text, arbitrary diagnostics and raw errors are excluded. Platform and per-session tool availability remain unknown. Preview and explicit copy are local; clipboard failure offers manual selection. Context changes, close, hide and disposal retire pending observations and copy feedback.

## Recorded document comparison (additive revision 1)

`health.documentCaptureComparison:1` advertises the read-only DTOs in
`shared/document-comparison.ts`. Protocol/schema remain 2. These authenticated
GET routes reject bodies, duplicate/unknown fields and malformed identities;
responses use `Cache-Control: no-store`. No source-file access, report write,
schema migration, persistent cache or approval/completion action occurs.

Both requests require `storeId`, `source`, `plan`, `cleanupRev` and `binding`
(JSON `{sourceId:string|null,verified:boolean}` of the expected service binding).
Replies echo these identities plus `sourceBinding`, protocol/schema and
`documentCaptureComparison:1`. Same-store rebinding and cleanup changes conflict
(409); missing plan/capture is 404. Archived plans remain readable. Capture off
does not erase history. A filtered list absence is not proof of deletion.

- **`/v1/document-captures`**, optional opaque `cursor`: descending immutable
  capture metadata (`id`, creation `revision`, `hash`, `capturedAt`, recorded
  `path`), at most 50 entries from 128 primary-key candidates per window. It
  returns `scanned`, `revision` (the pinned plan-revision ceiling), `exhausted`,
  `nextCursor` and `limit` (`rows`, `entries`, `bytes` or null). A cursor pins the
  store/binding/source/plan/cleanup, maximum ID and plan revision, so capture-ID
  reuse after unrelated deletion cannot introduce a newer capture. An empty
  window with a cursor does not mean no history. Metadata corruption fails the
  whole window; there is no silent skip or partial successful page.
- **`/v1/document-comparison`**, required positive safe-integer `before` and
  `after` IDs (`before <= after`): validates both same-plan captures and reads
  their bytes in one transaction. Returns both metadata records, `current`
  document/checklist state as observed at that read, and `result` with state
  `equal`, `diff` or `limited`. Equal text may have different capture IDs/paths.
  `limited.reason` is `bytes`, `lines`, `work` or `output`; no partial diff is
  presented as complete. A diff contains unified hunks, old/new line numbers,
  added/removed/context rows, explicit LF/CRLF/no-ending values, three context
  lines and omitted-context counts. Content remains literal text.

Discovery selects no document bodies or source-root envelope. Stored metadata
is bounded in SQL before materialization; current-plan JSON is admitted at
1 MiB, the document projection at 32 KiB and paths at 4096 characters. Cursors
are at most 4096 bytes, queries 16 KiB and replies 256 KiB. Comparison admits at
most two 262144-byte documents, 20000 lines each, one million diff steps and
one million retained integer trace cells. Output is at most 2000 lines and
128 KiB of line text within the reply limit. Newline-preserving lines are
interned before the numeric diff; no unbounded quadratic matrix is allocated.

Current checklist synchronization describes only `current.captureId` at the
observed revision. Historical synchronization is unknown. A later failed file
check can retain an older capture; capture time and last-check time are
different facts. `currentFile: not-rechecked` is always explicit. Neither an
equal diff nor a displayed capture proves that the live file is unchanged,
reviewed, approved, completed or synchronized with a checklist.

Package semver comes from the selected checkout or distribution’s
[package.json](../package.json) and is independent of protocol/schema **2**.
Setup and the loaded tool report their respective package versions; `/health`
`protocolVersion` and `schemaVersion` remain contract versions.

Canonical DTO: `shared/progress.ts` (protocolVersion=2, schemaVersion=2).
Changes to shared contract files (`shared/progress.ts`, `docs/contracts.md`) require
an announced contract revision before consumers update; consumers must switch
sequentially. The old `shared/contract.ts` ProbeRead is historical fixture code,
never a production fallback.

## Plan/task search revision 1 (frozen additive v2 read contract)

Ready `/health` adds **`planTaskSearch:1`**. Absence means unavailable, never
zero matches. Protocol/schema stay **2**; no migration, stored index, report-tool
change or new permission is involved. Canonical DTOs and ceilings are
`SearchOptions`, `SearchWindow`, `SearchHit`, `SearchState` and `SEARCH_LIMITS`
in `shared/progress.ts`. The real SQLite/HTTP fixture is
`tests/fixtures/plan-task-search.ts`; route proof is
`tests/backend/plan-task-search-service.test.ts`.

### Requests and identity

Authenticated body-free **GET `/v1/search`** accepts only:

| Query | Meaning / bound |
| --- | --- |
| `q` | Optional text, default empty; at most 256 Unicode code points, 16 nonempty whitespace-separated tokens; NUL refused |
| `source`, `session` | Optional existing-format ASCII identifiers (1–80 characters); omitted source means all recorded sources |
| `lifecycle` | Optional `active\|finished\|cancelled\|failed` |
| `status` | Optional task status `pending\|working\|blocked\|done\|skipped` |
| `archived` | `exclude` (default) or `only`; never implicitly includes both |
| `limit` | Integer 1–50, default 20; bounds emitted hits, not scanned plans |
| `cursor` | Optional opaque continuation, at most 4 KiB; return verbatim with identical other criteria |

The encoded query including `?` is at most 16 KiB. Reject rather than truncate.
Unknown or duplicate query fields return404; malformed values400; auth401;
method405; request bodies400; cursor/store/binding conflict409; unavailable,
corrupt, busy or unknown-schema stores503. Errors contain only fixed codes,
never query text, rejected keys, paths or exceptions. The HTTP parser separately
bounds total request headers at32 KiB; requests exceeding that transport limit
can be refused by Node before application routing.

First read returns actual `storeId` and `sourceBinding:{sourceId,verified}`.
Each response includes `protocolVersion:2`, `schemaVersion:2`,
`planTaskSearch:1` and a SHA-256 `fingerprint` of the complete backend criteria
(including raw query and output limit). Continuations bind that identity and
fingerprint. They contain only version, identity/fingerprint hashes, keyset
position, optional pinned plan revision/cleanup generation, membership revision,
task offset and classification/gap flags: no titles, bodies or credentials.
They are not durable jobs, signed authorization grants, a frozen library snapshot
or instructions to retain a server connection. Scope/account/host/live-membership
generation remains a separate consumer identity boundary.

Example: `/v1/search?q=export+csv&status=blocked&archived=exclude&limit=20`.
Every token must occur in the **same entity's own title or ID**; tokens cannot be
pooled across tasks or borrowed from the containing plan. Normalization is
`NFC → JavaScript toLowerCase() → NFC`, with Unicode whitespace splitting.
Case-insensitive ID punctuation remains literal; `%` and `*` are not operators.
Canonical accented spellings match; accents are not removed. This is simple
lowercase, not linguistic/full case folding (`Straße` does not match `STRASSE`).

### Search windows, grouping and counts

`SearchWindow` is **not** `Page<PlanSummary>`, a complete plan detail, a facet
census or an ordinary list prefix. It has:

- `hits`: zero to `limit` rows in binary `(source,id)` plan order, then stored
  task order. A row contains `plan`, `planMatched`, `task` (or null), `ancestors`,
  `omittedAncestors`, `continued`, and `classified`.
- `plan`: current full-plan summary identity/title/location/session, revision,
  structuralRevision, lifecycle, reportedAt, authoritative `counts`, explicit
  `cleanup:{state,revision}` (legacy visible generation0) and `sourceVerified`.
  No working-ID array, documents, source config/data roots or complete items.
- `task`: only `{id,title,status}`. Groups never match/count as tasks. Breadcrumbs
  contain `{id,title}` only; at most8, retaining root and nearest7 when deep,
  with the number of omitted intermediate ancestors. They are context, not hits.
- `planMatched`: whether the plan's own title/ID satisfies text. With no status,
  a plan qualifies for its own match or matching tasks. Matching tasks appear as
  rows; a plan-only hit appears only when there are no task hits. With status,
  only tasks satisfying text **and** status qualify; plan text cannot bypass it.
  Empty text plus status selects all tasks of that status. Lifecycle intersects
  at plan level; source/archive/session filters also precede emission.
- `classified:{matchedPlans:1,matchingTasks:N}` on the first emitted hit of a
  fully classified plan, null thereafter. `N` includes matches awaiting task
  continuation. `continued` is false on that first hit, true on subsequent hits
  of the same plan (including within the same window). This per-plan delta lets
  the board apply its frozen project/worktree predicate **before** counting.
- `counts:{matchedPlans,matchingTasks}`: sum of this window's non-null
  `classified` deltas, **not cumulative totals**. Accumulate once per traversal;
  task-continuation windows do not recount the plan. Full-plan done/total/
  remaining/skipped remain authoritative and never become filtered totals.
- `nextCursor`, `exhausted`: only `exhausted:true` with null cursor ends traversal.
  A full result page, empty window or work pause is not completion. Continuing
  after an output-byte boundary resumes the first un-emitted hit.
- `coverage:{kind:'recorded-current',asSearched:true,gapped,skippedRecords,reasons}`:
  gap flag is cumulative through continuation; skipped count/reasons describe
  this window. Fixed reasons are `invalid-snapshot`, `oversized-snapshot`,
  `invalid-membership`, `oversized-membership`. A skipped record advances once;
  unreadable/corrupt address keys or unknown cleanup formats instead fail closed.
- `work:{planSlots,inspectedItems,membershipRows,inputBytes,outputHits,outputBytes}`:
  measured plan-slot attempts (including an exhaustion lookup), items in accepted
  validated snapshots, returned membership rows inspected, accepted pre-parse
  UTF-8 input bytes, emitted hits and complete encoded response bytes. These are
  per request; resumed plans are inspected again, not served from a hidden cache.

Per transaction: at most64 raw plan-slot attempts,128 contribution rows,8 MiB
accepted snapshot/contribution input,1,000 items per plan,50 hits,8 ancestors per
task,256 KiB UTF-8 response. Raw keyset candidate work is limited **before**
archive/session/lifecycle/status/text predicates; an excluded prefix cannot cause
an unbounded scan to fill a page. An indexed source restriction is allowed.
Owner/current links resolve session membership first; otherwise revision-keyed
contribution windows resume membership instead of declaring a premature nonmatch.
A record too large to parse in one read (or a contribution that cannot coexist
with its snapshot in the input budget) is explicitly gapped, not looped forever.

In-plan task/membership continuation pins progress revision and cleanup generation;
change/disappearance requires refresh409. Completed earlier plans are not pinned
forever. Concurrent changes/insertions behind the cursor can change the observed
library. Accumulated counts mean **found so far**, or **as searched; reports may
change** after clean exhaustion, never a live/transactionally frozen census.
Gapped exhaustion cannot support an exact full-coverage claim. There is no
full-table count, history/body search, broad source enumeration, durable index,
persistent server cursor/job, server-wide cache or automatic continuation.

### Narrow freshness read

Authenticated body-free **GET `/v1/search-state?storeId=ID&keys=JSON`** accepts only
those two fields. `keys` is a JSON array of1–50 distinct `{source,plan}` identifier
pairs (object field order does not affect distinctness). The same16 KiB encoded
query and fixed error discipline applies. Wrong store returns409; empty, duplicate,
extra-field or oversized key lists return400. It returns `SearchState`: the same
minimal identity, a required boolean `captureEnabled` from store metadata, and
`data` in requested order, each row containing exactly the requested `source`, `plan`, `exists`, `revision` (null when missing), and
`cleanup:{state:'visible'|'archived'|'deleted',revision}`. An unknown key has
`exists:false`, null revision and visible generation0; a deleted key retains its
deleted cleanup generation. Capture state and plan rows share one read transaction.
No unsent keys, items, timing or history are read.

Freshness is authoritative metadata point-lookup evidence, not list-filter absence.
Archive/restore generation changes invalidate results even with unchanged progress
revision. Consumers revalidate displayed keys before reuse, retire continuation and
count authority on changed/missing identity, and offer Refresh search. Failure is
stale/unavailable, never an empty successful read. A missing/non-boolean capture
flag is invalid. Consumers combining freshness batches accept rows and capture
metadata only when all batches agree on capture state; a disagreement is stale
and retried on the normal cadence. Capture changes need not advance plan revisions.
Legacy schema2 and read-only stores work without creating cleanup tables or metadata. Search never mutates
reports, starts/assigns/completes tasks, opens sessions or accesses captured bodies.

## Reported blockers revision 1 (frozen additive v2 contract)

Protocol and schema remain **2**. This revision extends existing schema2 JSON
snapshots and the existing report/detail owners: **no new table, migration,
endpoint or health capability**. Optional fields are not an upgrade requirement.
Existing operations, required statuses, counts, authorization, source/assignment
checks, lifecycle, `oid`/`rev` and receipt semantics are unchanged. Types freeze
before the sequential producer and consumer switch; type declarations alone do
not establish runtime support.

### Deliberate annotation input

Task entries in `start`, `revise` and `stage` accept optional
`blocker: BlockerInput | null`; `commit` consumes staged entries atomically, not
a new top-level blocker parameter. Entries in `change.changes` accept the same
field. A change still requires `id` and `status`; a metadata-only edit repeats
`status:"blocked"`. No other new request fields are accepted.

```ts
type BlockerCategory = 'decision' | 'dependency' | 'review' | 'external' | 'other';
interface BlockerInput {
  category?: BlockerCategory;
  reason?: string;
  nextAction?: string;
}
```

Each supplied prose value must be a nonblank string of at most **512 JavaScript
string code units**, without NUL. Reject blank, NUL or oversized values rather
than truncating them. Missing category, reason and next action are independently
unknown; never synthesize them from titles, documents, inactivity, report age,
prompts, transcripts, tool output or passive host states. Producers supply
purpose-written safe summaries. Literal rendering and bounds are not a
secret-redaction guarantee.

Only the five listed categories are valid input. Unknown keys at every request
object level, including inside `blocker`, remain invalid. Callers cannot supply
annotation provenance, revisions or timestamps. Metadata describes a blocked
**task**, not a group, approval, assignment or separate success flag. Group
entries reject `blocker`, including null. A non-null object requires a blocked
destination. Structural requests resolve inherited status within the ordinary
transaction before accepting it. Incompatible entries reject the entire batch
without partial mutations. Existing **16,384-byte report** and **1,048,576-byte
complete response** ceilings remain; annotation limits do not override them.

### Replacement, retention and clearing

`blocker` is a complete replacement, never a merge:

| Input / boundary | Result |
| --- | --- |
| Explicit object | Replace all content fields; omitted members are unknown. `{}` deliberately records all parts unknown. |
| `null` on a task | Clear the annotation, without changing the requested status. |
| Omitted on a continuously blocked retained task | Retain only verified-current annotation content and its original provenance. |
| Creation, re-entry into blocked, remove/re-add, task-kind change or closed→reopen, with no explicit object | Annotation unknown; never recover earlier text. |
| Nonblocked destination | Clear annotation; a non-null object is invalid. |
| Finish, cancel or fail | Clear current annotations; immutable earlier revisions remain historical. |

Neutral title, link, bind, assignment and unrelated changes preserve valid
annotations. Reason edits alone do not change task status or restart its blocked
interval. Removing reason text does not resolve blocked status. A reporter can
explicitly change blocked→pending/working without completing the task. Staging
publishes neither annotation nor provenance before commit. Failed commit leaves
no partial current metadata. Identical receipt replay changes neither revision,
content nor attribution; changing an annotation under the same `oid` is
`operation-reused`, not an identical retry.

### Stored/read annotation and old-writer validity

`Item.blocker?: BlockerAnnotation` contains the optional content fields plus
required server-authored provenance:

```ts
interface BlockerAnnotation extends BlockerInput {
  reportedRevision: number;
  reportedAt: string;
  reporterSessionId: string;
  attributedSessionId: string;
  mode: 'direct' | 'parent-relay';
  validAtRevision: number;
}
```

Both revisions are positive safe integers and
`reportedRevision <= validAtRevision === enclosing plan.revision`. `reportedAt`
uses the existing ISO timestamp convention; session IDs use the existing 1–80
character identifier rule. A direct annotation attributes the actual caller; a
relay attributes only its already-authorized child and keeps the actual reporter
separate. Explicit structural annotations are authored at the committed revision
and timestamp, never the staging time. Retention preserves original provenance,
even if a newer status-only report has a different reporter. Existing contribution
records and their possibly empty structural `itemIds` do not change meaning.

Before **every committed new-writer mutation**, inherited annotations qualify for
retention only if their complete shape is valid and `validAtRevision` equals the
**previous** plan revision. Clear at the relevant boundaries above, then stamp
retained or explicitly new annotations with the new revision. Never recertify a
stale inherited annotation. An older writer may copy unknown item fields without
advancing their marker, or drop them during structural replacement. Either way,
after any such committed mutation the old annotation is unknown until explicitly
reported again; a later new-writer neutral write cannot revive it. Receipt replay
and uncommitted staging are not new committed plan revisions.

`Store.detail`, including explicit-page tool reads, suppresses stale/malformed
annotations without rewriting snapshots. The UI adapter independently checks
shape, bounds, provenance and revision equality to defend against older services
returning raw inherited fields. Missing optional content remains unknown. Invalid
optional content produces a fixed unavailable/invalid state, never rejected text
or errors interpolated into the view. Unknown future category strings are
unclassified (Category unknown), never mapped to one of the known categories.
Absent metadata from older producers/services is not evidence of no blockers or
success. Older consumers may ignore these additive fields; older producers are
not automatically sent unsupported parameters or forced to update/reload.

Only `assigneeSessionId` supplies recorded responsibility. Annotation reporter,
attributed child, plan owner and historical contributors are distinct facts, not
implicit assignees. If only an item reporter is known, label that fallback without
inventing a report mode or claiming it authored the current reason.

Example requests, starting with an existing revision-1 task named `format`:

```json
{"op":"change","plan":"P-format","oid":"report-wait","rev":1,"changes":[{"id":"format","status":"blocked","blocker":{"category":"decision","reason":"Choose an output format","nextAction":"Select CSV or JSON"}}]}
{"op":"change","plan":"P-format","oid":"clear-details","rev":2,"changes":[{"id":"format","status":"blocked","blocker":null}]}
{"op":"change","plan":"P-format","oid":"resume-task","rev":3,"changes":[{"id":"format","status":"pending"}]}
```

Use actual current revisions and fresh operation IDs. A subsequent
explicit-page tool read or service detail read at revision 2 may contain the
following item excerpt; the second request clears its annotation but leaves the
task blocked; the third removes reported-blocked membership without adding a
done task:

```json
{"id":"format","title":"Select format","kind":"task","status":"blocked","blocker":{"category":"decision","reason":"Choose an output format","nextAction":"Select CSV or JSON","reportedRevision":2,"reportedAt":"2026-01-01T00:01:00.000Z","reporterSessionId":"M","attributedSessionId":"M","mode":"direct","validAtRevision":2}}
```

### Separate reported-blocked timing

Only service `GET /v1/plan` adds optional `blockedTiming?: BlockedTiming`.
It is **response-only**, distinct from `timing`/`PlanTiming`, which continue to
describe reported-working intervals unchanged. No stored duration, caller start
timestamp, tool receipt expansion or timing in compact/explicit-page tool reads
is introduced.

```ts
interface BlockedTiming {
  readAt: string;
  items: Record<string, { since: string; kind: 'exact' | 'lower-bound' }>;
}
```

It belongs to the enclosing store/source/plan/revision and covers eligible
currently blocked tasks across the **whole validated current snapshot**, not the
returned page prefix. Groups, nonblocked tasks and closed plans have no entries.
Absent timing means unavailable; missing/unusable entries mean unknown, never
elapsed zero. An empty map is not an empty-success assertion about blockers.

- **Exact:** `since` is the first blocked snapshot after creation or a proven
  nonblocked, absent, non-task or closed boundary.
- **Lower-bound:** a valid contiguous capped suffix proves only its earliest
  accepted blocked observation; say “at least” and that the start is unknown.
- **Unknown:** gaps, corrupt/missing snapshots, future/regressing timestamps or
  identity/current-snapshot mismatch cannot supply a start claim. Do not bridge
  invalid history or substitute latest report/contribution age.

Repeated blocked, relay, reason-only and neutral reports do not reset the
interval. Unblock/reblock, remove/re-add, task-kind boundaries and close/reopen
do; redundant active reopen is neutral. Timing is independent evidence of
reported blocked status, **not** evidence that inherited annotation text is
current: stale annotation provenance never becomes valid merely because a
status interval can be proved.

Derivation uses the existing Store connection in a finite read transaction pinned
to the detail revision. Validate full current identity, lifecycle/time, unique
bounded items and agreement with the returned page before selecting blocked IDs.
Bound the reverse history scan to **128 snapshot visits, 8 MiB admitted snapshot
text and 1,000 task entries** per detail request, never per task. Admit byte length
in SQL before materializing text. With the independent working reader, combined
timing work is at most **256 snapshot visits / 16 MiB admitted text**. List and
history routes do not scan timing; no retained Store handle/cache, history rewrite,
background backfill or additional list scan is introduced.

Example service response excerpt at revision 2:

```json
{"blockedTiming":{"readAt":"2026-01-01T00:06:00.000Z","items":{"format":{"since":"2026-01-01T00:01:00.000Z","kind":"exact"}}}}
```

Anchor displayed elapsed to server `readAt - since`, advancing from a local
monotonic receipt-time anchor on the existing frame ticker. Preserve that anchor
on cached revisits/repaints; do not subtract server timestamps from browser wall
time or create per-task timers/requests. New replies supply new server anchors;
network transit makes the display approximate. Invalid/future times mean unknown,
not zero. This measures continuous **reported blocked status**, not actual
real-world waiting, model activity, working time or a viewer's personal obligation.

### Detail identity and current attention

Annotations/timing require complete matching detail. Restart/refuse mixed
progress revisions **or cleanup states/generations** across pages; never combine
pre-cleanup annotations with restored/current detail. Retire data and callbacks
on source/store/binding, scope, selected-plan, cleanup, hide and dispose boundaries.
Held retired replies cannot restore attention or issue further continuations.
No new polling owner or subscription budget is introduced.

Current attention requires a visible active plan and an explicitly blocked task.
Finish/cancel/fail stop it without converting leftover task statuses to acceptance.
Archive/delete cannot supply current attention; restore leaves a finished plan
finished. Explicit reopening uses existing semantics and current reports only.
One row represents each store/source/plan/task identity, without cross-plan
text/title deduplication. Complete active empty detail may say “No reported
blockers”; partial, loading, unavailable, stale and capture-off data cannot make
that unqualified claim. Blocker text/provenance/timing are not added to summary
exports, search indexes or automatic notifications/actions.

## System boundaries

The system has four components: an OpenCode companion plugin that captures explicit
reports; an independent local SQLite progress store; a host-owned loopback service;
and three guest frames (the session-scoped rail, compact Work Status, and fullscreen
cross-project board). Capture writes directly to the store and has an independent
lifecycle: it continues while OpenChamber is closed or the extension is uninstalled,
until explicitly disabled or removed. Stored history is retained on capture removal.
The board lists recorded plans and enriches them with host workspace snapshots;
discovery is not guaranteed complete, and missing or partial live coverage is shown
explicitly. Capture and service require the same host/account and shared local
files; there is no cross-host transport.

## Reporting participation

Tool registration and guidance do not guarantee that an agent reports progress.
The UI shows report age, coverage and reporter attribution rather than inferring
progress from session activity. Missing reports remain unknown, not completion
or failure.

Resume pointer delivery or consumption is not a reporting action, receipt,
compliance, acceptance or completion. Titles and labelled last-known revisions
are recorded hints; explicitly read current state before any mutation (including
after conflict), and read and confirm a target before reporting from a candidate list.
Neither delivery nor a subsequent read establishes current source-file freshness
or human approval. The capsule selects no action and grants no new permission.

## Tool invocation validation help (additive v2)

The flat tool input schema remains provider-compatible; operation-specific
requirements are enforced by `parseRequest` and described directly in the tool.
Every mutation requires `oid` and expected `rev`. New `start` also requires title
and complete items, using `rev:0`; read accepts only op, one concrete plan ID and
optional 0-based page, never a wildcard or mutation fields. Omit page for a compact
summary without items; explicit page returns paged detail. No defaults are inferred.

Tool replies retain `error` and optional conflict `rev`. Only `error: "invalid"`
may additionally carry optional `hint`, bounded constant recovery text (at most
256 characters), with no submitted values, unknown field names, paths or exception
messages echoed. Consumers must continue to branch on `error`, not hint wording;
older/generic errors may omit it. Service HTTP errors remain code-only. This adds
no protocol/schema version, persisted field, read behavior or permission change.

## Advisory activation does not change the protocol

The companion can add one owned section to an eligible outgoing primary context
and one conditional possible-plan-file hint. Neither is a report receipt, plan,
assignment, review/acceptance, capture, or completion event. Existing explicit
`agent_progress_report` operations, source-optional inputs, transactional control,
authorization and outputs remain unchanged. Hidden/restricted tools are never
enabled by guidance; a child still needs explicit assignment and permitted relay.
Unknown tools, shell/opaque patches and arbitrary/non-Markdown paths are not
inferred as plan documents. Structured plans need no file. There is no new
service/RPC field, durable hint state, prompt configuration or global gate.

Recovery is an optional addition inside that same owned section, only after a
host compaction observed during the loaded plugin lifetime: a live start, an
observe-only compaction hook and an increasing, matching-reason successful end
must pair for the same session/source. Hook/start callback delivery order is not
identity: start→hook→end and hook→delivered-start→end are supported when event
creation times strictly contain the local observation window:
`start.created < firstHookTime <= lastHookTime < end.created`.
No shared attempt token exists on the inspected surfaces. Equal boundaries,
inconsistent/backward clocks, stale observations and overlapping starts decline;
the temporal fallback is not a unique identity or a guarantee for background
precomputation or arbitrarily inverted durable streams. A start or hook alone is not success.
Accepted terminals retire open evidence; failure clears pending recovery.
The first following primary context attempt consumes pending and incomplete
evidence before awaits, retaining a creation-time fence against delayed backfill even if
delivery safely declines. Ordinary turns and uncompacted resumes do no recovery
lookup and retain today's eligible generic guidance. Failed compactions retire
pending recovery; title/generate and summarization requests receive no capsule.
Observation never reads summary text or changes compaction inputs or `result`.

A complete single eligible result is labelled **recorded pointer**; multiple
results or incomplete/omitted coverage are **unconfirmed candidates**, including
an incomplete singleton. Each entry renders the source/plan identifiers, a
JSON-quoted literal title, **last-known revision**, and an explicit concrete-plan
read example. Candidates require reading and confirming a target before reporting;
known omissions disclose that additional eligible candidates may exist, not an
invented exact total. Assigned children receive only the plan pointer and their
complete assigned item IDs with an assigned-only restriction. Eligibility is
defined below; missing/restricted report tools stay missing/restricted.

Observed disable, source/store binding changes and disposal retire pending and
held recovery; re-enable does not backfill. Control is sampled at observer/context
boundaries and after awaits, not polled: an off/on transition entirely between
observations is not guaranteed to be observed. The final authoritative Store read
excludes closed, archived, deleted or no-longer-assigned work. Already dispatched
text cannot be retracted and remains last-known, subject to the unchanged explicit
read/expected-revision mutation protocol. No plan payload is cached across turns.
Unavailable recovery observation or lookup suppresses the capsule without
suppressing otherwise eligible generic guidance or possible-plan-file hints.

### Internal resume read contract (revision 1)

`Store.resumePlans` is a synchronous read-only projection on the existing connection
and read transaction. `ResumeRequest`, `ResumeSelection` and the narrow `ResumeRead`
callback live in `shared/progress-resume.ts`; activation receives the callback, never
the Store, mutation executor or capture access. Requests carry expected `storeId`,
`sourceId`, `sessionId`, `parentId` and complete authoritative `ancestry` (nearest
parent first; null means unknown). Binding, verified source and current enabled
state are checked in that transaction. Missing/uncertain authority returns null;
corrupt required metadata rejects the entire lookup, including previously found
candidates. Callers suppress recovery on read errors, not ordinary generic guidance.

Only visible `lifecycle === 'active'` plans qualify. Root sessions qualify only
for plans they coordinate. Helpers qualify only for a current nonempty explicit
link whose coordinator is an authoritative ancestor, with consistent task assignees;
their independently coordinated work does not qualify. Finished, cancelled, failed,
archived and deleted plans cannot supply recovery. Closed-only sessions retain
otherwise eligible generic guidance without a capsule. History, contributions,
directory similarity and session-tree membership alone never establish authority.

Candidates contain only `sourceId`, `plan`, literal `title`, last-known `revision`
and `scope:'coordinator'` or `scope:'assigned'` with complete `itemIds`. No task
prose, statuses, counts, blockers, document content or source roots escape in a
candidate. `omitted` denotes known candidate/scope omissions; `incomplete` denotes
unfinished discovery. Either flag prevents a uniqueness claim, even for a singleton.
The bounded list is unconfirmed, with no invented exact total. The source ID is
namespace metadata, not the tool's document-path `source` argument: explicit reads
use `agent_progress_report` with `op:'read'` and one concrete `plan` only (optional
explicit page), never manufactured source/oid/rev parameters.

### Adopted bounds / compatibility — progress resume

Selection returns at most **3** candidates in binary plan-key order and stops at
a fourth with omissions/incomplete coverage. Helpers receive at most **20** assigned
IDs per candidate; larger scopes are omitted completely, never partially represented.
Each lookup admits at most **64** source-plan slot attempts (including exhaustion),
**1 MiB** per snapshot and **8 MiB** total JSON, with byte admission in SQL before
text is returned. Validation bounds remain **1000** items and **64** links per plan.
Excluded lifecycles still consume scan work, not candidate slots. The result includes
`work:{planSlots,snapshots,inputBytes}` and fixed `limit` metadata (`slots`, `bytes`,
`time`, `candidates` or null). These counters are diagnostic, not child task scope.

A **100 ms cooperative scan budget** is checked between bounded steps using a
monotonic clock (injectable for tests). Already proven candidates may survive a
budget stop only as incomplete/unconfirmed results; zero candidates means no capsule.
SQLite's existing busy ceiling is at most **1 s**. Neither budget is a hard total
latency guarantee: a synchronous admitted parse or busy wait can exceed the scan
budget. No automatic continuation, history/document scan, cache, schema/index,
write, new connection or public endpoint is introduced.

Rendering adds at most **4096 UTF-8 bytes**, within the one existing advisory
section. Whole candidates are removed to fit, with unconfirmed/omission wording;
identifiers and safety instructions are never truncated. A candidate that cannot
fit is omitted. Quoting titles treats them as literal data, not as a promise of
prompt-injection prevention or secret redaction.

Activation retains at most **128** session compaction records and **256** event
replay identities, independently of existing file-hint bounds. Orphan hooks and
primary retirement tombstones use that same session cap; each
record holds at most one constant-size first/last observation window and open start.
No new timer or persistent correlation is added. Eviction,
reload or retirement can lose an advisory opportunity; they never reconstruct
one from transcripts. Capsule-only authoritative identity work has a **1 s**
deadline with cancellation checkpoints before and after each ancestry await
(at most **32** hops). At most one recovery identity lookup is outstanding; a
host lookup ignoring cancellation cannot start another hop or later inject its
retired result. Its outstanding call can temporarily suppress further recovery.
The request-scoped deadline timer is cleared after use; no background poller exists.

OpenCode **2.2.2** scripted-provider integration with the unchanged **2.1.4**
plugin/client adapter verifies source-built and emitted-companion production recovery at
the actual outgoing boundary, not model compliance or desktop-native behavior.
Earlier2.1.4 integration evidence remains historical, not freshly recertified.
Native plugin reload does not re-arm an old completion; a fresh compaction still
delivers. **Host replay remains unexercised:** the pinned event stream is live-only
and volatile, with no replay controls. Duplicate/sequence guards are unit-tested,
not certified against a host-replayed event. After reload or a missed event,
generic guidance remains until a newly observed successful compaction. Broader
runtime/version compatibility is not established. Commands and evidence scope
are in [the compatibility guide](compatibility.md#progress-resume-capsule-verification).

## Fixed authenticated read API

Every route requires the host bearer, including `/health`; bind127.0.0.1 only.
Guests use SDK serviceRequest and never receive bearer/port. Read routes use GET:

- `/health`: `{ok:true,ready:boolean,sqlite:boolean,protocolVersion:2,schemaVersion:2,runtime:{node,bun},diagnostics?}`.
  Unconfigured service is200/ready=false, never an empty progress success;
  corrupt/unsupported configured stores return503 with their fixed diagnostic.
- `/v1/plans?cursor=0&limit=20&source=ID&session=ID&directory=TEXT`: filters optional;
  `{...Envelope,...Page<PlanSummary>}`. Cursor is an offset; continuation reads
  may see newer revisions, not a falsely frozen cross-request snapshot.
  Session matches creator, current assignment or recorded attributed contribution.
  Directory matches the plan or last-known contributing/assigned session directory;
  labels remain recorded metadata, not live SDK coverage.
- `/v1/plan?source=ID&plan=ID&cursor=0`: `{...Envelope,...PlanRead}`. Cursor advances
  items and contributions in stable stored order; links are current. Return each
  nested nextCursor verbatim as cursor; stop when both are null. If plan.revision
  changes across pages, restart the selected detail read instead of mixing revisions.
- `/v1/document?source=ID&plan=ID&cursor=0&capture=NUMBER`: `{...Envelope,...DocumentRead}`;
  capture is optional on first read; pin returned captureId on continuation pages
  to avoid mixed document versions. Historical capture returns historical-capture
  diagnostic, not a current-checklist claim. Unicode-character cursor; no files.
- `/v1/history?source=ID&plan=ID&cursor=0&limit=20`: envelope/page of
  `{revision,structuralRevision,lifecycle,reportedAt}`. No full snapshot per row.

Unknown routes/queries404; wrong method405; auth401; invalid parameters400;
not-found404; unavailable/corrupt/schema/busy stores503 with fixed codes.
No-body/query POST `/v1/capture/disable` and `/v1/capture/enable` change the
transactional control, not history. Disable remains available for a loaded
instance even with modified files; enabling requires verified installed ownership.
The setup routes below share the standalone utility's validator, never a general
filesystem endpoint. Service reports record-only coverage, not live
SDK coverage. Navigation must be verified against the CURRENT host.

## Plan change digests (frozen additive read contract)

See also the independent **Plan/task search revision 1** contract above. Search
does not change list/detail/document/history, reporting, or change-digest semantics.

A ready service advertises `planChangeDigests:1` on `/health`; absence means
unavailable, not an empty comparison. Protocol/schema remain 2. Authenticated,
body-free **GET** `/v1/change-digest` accepts only `storeId`, `source`, `plan`,
`to`, `cleanupRev` and optional `after`. Identity strings use the existing
identifier rule. `to` and `after` are positive safe integers (including values
above nine digits); `cleanupRev` is a nonnegative safe integer. `after > to` or
a target beyond the live revision is invalid. No cursor or viewer token exists.

```http
GET /v1/change-digest?storeId=store-fixture&source=source-fixture&plan=P-digest&after=1&to=6&cleanupRev=0
```

`ChangeDigest` is exported through `shared/progress.ts`; its definitions and pure
classification live in `shared/change-digest.ts`. The following field names are
the wire contract; `Counts`, `Status` and `Lifecycle` retain their existing meanings:

```ts
type DigestFacet = 'added' | 'removed' | 'revised' | 'completed' | 'reopened'
  | 'blocked' | 'unblocked' | 'skipped' | 'unskipped';
type DigestEvents = Record<DigestFacet, number>;
type DigestReason = 'gap' | 'missing-snapshot' | 'invalid-snapshot'
  | 'revision-bound' | 'byte-bound';
interface DigestFacts {
  title: string; status: Status; parentId: string | null; dependencies: string[];
}
interface DigestReference {
  from: number; to: number; reportedAt: string; facets: DigestFacet[];
  before: DigestFacts | null; after: DigestFacts | null;
}
interface DigestTask {
  id: string; title: string; status: Status; presentAtTarget: boolean;
  latestRevision: number; occurrences: DigestEvents;
  references: DigestReference[]; omittedReferences: number;
}
interface DigestScope {
  addedCounted: number; removedCounted: number; skipped: number; unskipped: number;
  addedDone: number; removedDone: number; completed: number; reopened: number;
}
interface ChangeDigest {
  protocolVersion: 2; schemaVersion: 2; storeId: string;
  sourceBinding: { sourceId: string | null; verified: boolean };
  source: string; plan: string;
  cleanup: { state: 'visible' | 'archived'; revision: number };
  interval: {
    after: number | null; to: number;
    targetLifecycle: Lifecycle | null; targetReportedAt: string | null;
    latestRevision: number; currentLifecycle: Lifecycle;
    coverageStart: number | null; coverageEnd: number | null;
    coverageStartReportedAt: string | null; coverageEndReportedAt: string | null;
  };
  availability: 'initial' | 'comparison' | 'baseline-unavailable' | 'target-unavailable';
  complete: boolean; reasons: DigestReason[]; validTarget: boolean;
  counts: { before: Counts | null; after: Counts | null; scope: DigestScope | null };
  summary: { unit: 'transitions'; events: DigestEvents };
  tasks: DigestTask[];
  details: { omittedTasks: boolean; omittedTaskCount: number | null; truncated: boolean };
  work: { intervalSnapshots: number; baselineLookups: number; inputBytes: number };
}
```

One transaction pins existence, cleanup, live metadata, target, baseline and event
coverage. Consumers must match **all** request identity fields and source binding,
not just a revision. `to`/`after` are never silently substituted. `latestRevision`
and `currentLifecycle` describe that read's live plan, not a promise of freshness
after delivery. Coverage endpoints describe validated snapshots; events cover
only adjacent pairs inside that range. Timestamps are recorded ISO timestamps,
not observation or completion times. With no proven pair, coverage may be `to→to`.

- No `after`: `initial`, target counts only, no invented revision-zero events.
  `complete:true` means this initial target read succeeded, not that history was scanned.
- Valid endpoints: `comparison`; `after === to` is complete and empty with equal counts.
- Missing/invalid/budget-excluded baseline: `baseline-unavailable`, never initial;
  `counts.before` and `scope` stay null. A proven recent suffix can still be shown.
- Missing/invalid/budget-excluded target: `target-unavailable`, `validTarget:false`,
  null target/coverage/counts and no events; cannot be reviewed.
- `complete:false` qualifies interval events, independently of exact endpoint counts.
  `reasons` is a deduplicated set of fixed diagnostics, not a diagnostic ordering
  contract. Never bridge missing/invalid snapshots; a baseline lookup alone cannot
  certify intermediate events. Unknown history must not be labelled zero changes.

Tasks alone count; skipped tasks are outside `total`, groups never contribute.
`counts.scope` explains endpoint deltas separately from witnessed transitions:
`totalDelta = addedCounted - removedCounted - skipped + unskipped`;
`doneDelta = addedDone - removedDone + completed - reopened`.
Here `completed`/`reopened` describe **surviving endpoint tasks**, not interval
event totals. Display percentage is `Math.round(done / total * 100)` only when
total is nonzero; do not allocate causal percentage points to individual facets.

Summary/occurrences count transitions, not distinct tasks. Reversals survive:
reported blocker then unblocked, or completed then reopened, do not cancel out.
Added-as-done is added scope, not a witnessed completion. Added-as-blocked also
has a `blocked` facet. Removing a blocked task is not resolving its blocker;
removing a done task is not reopening it. Task↔group conversion is removal/addition.
`unblocked` means no longer reported blocked, including a skipped destination,
not proof an underlying problem was solved. Title/parent/dependency-set changes
are `revised`; dependency order, metadata, group-only and pending↔working changes
alone are not highlights. Identical statuses/fresh operation IDs add no events;
receipt replay adds no revision. Staging adds no events before commit.

Rows are recent-highlight-first, ties by ascending task ID. For surviving tasks,
title/status are recorded at the target; historical-only rows use their most
recent change facts. `presentAtTarget` does not certify presence in today's live
task tree. Each reference records the actual adjacent pair, including nullable
addition/removal facts and sorted dependency sets. At most 50 task rows and four
recent references per retained task are emitted; occurrences still cover the
proven suffix. `omittedReferences` counts dropped references per retained task.
`details.truncated` covers any row/reference omission, **not** interval gaps.
When unretained identities prevent an exact distinct omitted-task count,
`omittedTaskCount:null` and `omittedTasks:true` disclose that uncertainty.
Otherwise the count is exact (zero if none). Summary facts survive detail caps.

Example comparison excerpt for a blocked→working→done task and one new pending task:

```json
{"availability":"comparison","complete":true,"validTarget":true,"reasons":[],"counts":{"before":{"done":1,"total":2,"remaining":1,"skipped":1},"after":{"done":2,"total":3,"remaining":1,"skipped":1},"scope":{"addedCounted":1,"removedCounted":0,"skipped":0,"unskipped":0,"addedDone":0,"removedDone":0,"completed":1,"reopened":0}},"summary":{"unit":"transitions","events":{"added":1,"removed":0,"revised":0,"completed":1,"reopened":0,"blocked":1,"unblocked":1,"skipped":0,"unskipped":0}}}
```

Work is bounded to 128 interval snapshots plus at most one separate baseline
lookup, sharing 8 MiB of input before parsing. `work` reports inspected interval
slots (including unavailable/oversized attempts), baseline lookup attempts and
actual snapshot bytes returned for parsing; reused baseline text is not reread.
The body is at most 256 KiB UTF-8; least-recent rows are dropped first while
preserving summary/counts/qualification. There is no continuation/backfill.

Auth errors are 401, wrong method 405, unknown/duplicate fields 404, missing or
malformed fields/ranges 400 (`invalid`), store/cleanup mismatch 409 (`conflict`),
missing/deleted plan 404 (`not-found`), unavailable/corrupt/schema/busy storage
503 with fixed codes. An unusable historical snapshot is a qualified 200 DTO,
not a fabricated success comparison. Archive/restore preserve baseline history
but change cleanup generation, so stale reads refuse. Reopen preserves identity.
Delete makes new reads fail; an already captured response must be retired by the
consumer's live identity/cleanup checks and cannot authorize review by itself.
No backend checkpoint, mutation, filesystem capture, schema change or cache is
introduced. List/detail/history routes do not invoke digest comparison.

## Finished-plan cleanup (frozen additive contract)

This additive cleanup contract keeps protocol/base schema **2**. A ready capable
service adds `planCleanup:1` to `/health`. Missing capability means unavailable,
not an empty archive. No report-tool operation is added.

Authenticated, query-free **POST** `/v1/plan/archive`, `/v1/plan/restore`, and
`/v1/plan/delete` accept only this JSON body (identifiers use the existing80-character
identifier rule; revisions are safe nonnegative integers, `rev` strictly positive):

```json
{"storeId":"store-fixture","source":"source-fixture","plan":"P-done","rev":2,"cleanupRev":0,"oid":"archive-example"}
```

Delete additionally requires literal `"confirmed":true`; archive/restore refuse
that extra field. Capture the actual store ID and progress/cleanup revisions from
the selected record, not these illustrative values. No paths, arrays, wildcard,
session changes or unknown fields are accepted. Confirmation must remain bound to
that captured key/revisions across context changes. Opening/cancelling sends nothing.

Archive is the ordinary action; only lifecycle `finished` is eligible. Restore
requires archived+finished and leaves it finished; deletion accepts visible or
archived finished plans. Counts, report age and immutable progress history do not
change on archive/restore. Cleanup works while capture is disabled without enabling it.

Success200 is a bounded receipt, not a plan or progress revision:

```json
{"storeId":"store-fixture","source":"source-fixture","plan":"P-done","cleanup":{"state":"archived","revision":1},"oid":"archive-example"}
```

Restore with `cleanupRev:1`, a new oid and the same `rev` returns state `visible`,
revision2. Delete with a fresh oid, `cleanupRev:2` and `confirmed:true` returns
state `deleted`, revision3. Each transition increments the independent cleanup
generation; progress revisions stay untouched. Only the latest identical request
can replay its receipt (including delete after the plan is gone). Changed reuse
of the latest oid refuses; older requests conflict, even after a restore. Do not
blindly resubmit an ambiguous action: reconcile authoritative reads and show errors.

Errors are code-only; no submitted values or exception text is returned:

| Status | Example / meaning |
| --- | --- |
|400|`{"error":"invalid"}` malformed, extra fields, missing/false confirmation|
|409|`{"error":"conflict"}` wrong store, stale progress revision or cleanup generation|
|409|`{"error":"closed"}` non-finished plan or ineligible state transition|
|409|`{"error":"operation-reused"}` latest oid with altered semantic input/action|
|404|`{"error":"not-found"}` missing/deleted key, unknown route or query|
|401/405|`{"error":"unauthorized"}` / `{"error":"method-not-allowed"}`|
|413|`{"error":"request-too-large"}` above16,384 bytes|
|503|`{"error":"busy"}`, `{"error":"storage"}`, `{"error":"schema"}`, `{"error":"corrupt"}` or existing binding diagnostic; no partial success|

`GET /v1/plans` accepts `archived=exclude|only`, default `exclude`. This filter
applies **before** cursor/limit, with unchanged source/session/directory matching.
Never merge the two modes' caches or pages. Optional response-only
`PlanSummary.cleanup = {state:'visible'|'archived',revision:number}` describes that
record; on a capable service its absence means visible/generation0. Restore keeps
the visible metadata/generation, never resets it. Archived detail, history and
pinned document captures remain readable. Deleted keys return404 on every read,
including old capture IDs. There are no deleted list entries.

On action success retire pre-action reads and clear affected list memories,
selection/detail/document/history caches before fetching authoritative state.
Cleanup need not change the progress revision; revision-only cache equality is
insufficient. Ignore late replies from retired host/store/action generations.
Other frames converge on their existing successful refresh, not a new bus/poll rate.

### Recovery and rollback limits

No GET, service open or ordinary capture initializes the cleanup extension. After
read-only eligibility checks, first explicit cleanup takes a verified private
SQLite snapshot at `cleanup-backup-<random>.sqlite` in the verified private store
folder (POSIX0700/file0600; on Windows the existing native path/owner/DACL policy
and private inherited file ACL), then revalidates and atomically installs format1 metadata and persistent
guards with the action. A racing or failed action can leave recovery material;
it cannot partially change the selected plan. Unknown format/missing or altered
guards fail closed, never silently repair/reset. No arbitrary backup destination.

Delete removes selected live-store items, revisions, contributions, captures,
staged uploads and report receipts, retaining only key/state/generation and bounded
latest-operation hash/receipt. Original source files, unrelated/source-isolated
plans, shared sessions and installation history stay intact. **Not secure erasure:**
SQLite free pages, journals, backups and filesystem snapshots may retain content.
The first-use recovery backup may contain the deleted plan. Do not imply an undo
button or silently purge those files.

Persistent guards fence both already-loaded and newly opened older schema2
writers. New writers refuse archived work with `closed`, deleted identities with
`not-found`, before report receipt replay. Older writers may return generic storage
errors; their old readers can show archived plans again. Restoring permits normal
explicit reopen of a still-finished plan; deletion never frees its ID for reuse.
Use a new plan ID for genuinely new work. Application rollback must retain guards,
tombstones and cleanup tables. Never downgrade by resetting the store or restoring
the first-use backup automatically: that would lose later acknowledged reports.

### Disposable real-service fixture

From the repository with Node24 on PATH:

```sh
node --experimental-strip-types tests/fixtures/cleanup-service.ts
# Built-entry variant after backend build:
node --experimental-strip-types tests/fixtures/cleanup-service.ts --built
```

Both launch an actual authenticated loopback HTTP service with exclusively fresh
synthetic data and print one JSON readiness line only after `/health` reports
`ready:true,planCleanup:1`. Use the returned `url` and fixture-only bearer
`fixture-only` in a browser test's SDK serviceRequest transport adapter; no host
installation, real config or history is used. Fetch `/v1/plans?source=source-fixture`
for actual store/key/revision inputs. The readiness line's `finished` object is the
initial archive body for P-done. Its document/history, long Unicode title, P-active,
P-other, cancelled/failed records, other-source P-done and55 pagination records are
seeded. Source binding is source-fixture; session M, directory `/fixture/Alpha`.
Send SIGTERM/SIGINT to stop owned service processes and remove the disposable roots.
Rerun to reset all data; never repoint it at a real binding. The built variant uses
the actual checked-in service entry and temporary descriptor, not setup/install.
Local execution/results and consumer launch receipt: `evidence/cleanup/backend.md`.

## DTO meanings

### Official-main version awareness

`GET /v1/extension-update` requires the same service bearer, no query/body, and
works before companion/store lookup. Wrong method405, query404, body400, auth401.
Upstream failure is an HTTP200 metadata reply, not a progress/setup failure.
Older services may return404; missing/malformed optional replies mean unavailable.

```ts
interface ExtensionUpdateRead {
  installedVersion: string; // this extension's RELEASE
  repository: 'Phototonic/openchamber-progress';
  ref: 'main';
  state: 'available' | 'not-newer' | 'unknown';
  checkedAt: string | null; // most recent SUCCESSFUL validation/revalidation
  stale: boolean;
  candidateVersion?: string; // validated official-main manifest semver only
  diagnostic: 'ok' | 'unavailable' | 'rate-limited' | 'invalid-manifest' |
    'invalid-response' | 'redirect' | 'too-large' | 'timeout' | 'shutdown';
  nextCheckAt: string; // finite server ISO time; next eligible check, not a timer promise
}
```

`available` means only that the named official main advertises a higher semver.
`not-newer` means that official manifest is equal/older, not that a custom selected
source, companion or loaded instance is current. Same-version changed bytes do not
produce availability. `unknown` has no validated candidate, checkedAt=null and
stale=false. After failure, a known candidate/state and original checkedAt remain,
with stale=true and a fixed failure diagnostic. Do not render retained stale
knowledge as a fresh successful check. No upstream body, message or URL is returned.

This does not inspect actual installation provenance or audit remote runtime files.
The host alone installs updates. Use fixed UI link
`https://github.com/Phototonic/openchamber-progress/tree/main`; never derive a link
from network metadata. Copy names **“Official main version X available”**, explains
Settings → Extensions and the custom branch/tag/fork/ZIP limitation. Never claim
the advertised candidate is installed, bundled, loaded or installable merely from
this metadata check. Preserve SetupRead.update and its explicit companion button.

Ask on visible-frame readiness and coarse nextCheckAt eligibility, not each progress
poll/task/render/session switch. Hidden/disposed frames initiate no request; retire
late replies on host/service generation changes. A service restart starts a new
in-memory cache. Cache successful knowledge for1h, failures for at least5min (longer
provider deadlines honored); multiple frames share one service in-flight request.

### Optional reported-working timing

Only service `GET /v1/plan` adds the following response-only field. Older services
may omit it; absence is valid and means no elapsed claim. Stored items, tool input,
tool read output, schema and protocol remain unchanged at2.

```ts
interface PlanTiming {
  readAt: string; // server ISO timestamp for this reply, never a cached timestamp
  items: Record<string, { since: string; kind: 'exact' | 'lower-bound' }>;
}
// PlanRead gains: timing?: PlanTiming
```

The object belongs to the enclosing storeId/sourceId/plan.id/plan.revision. Entries
cover proven currently working tasks across the whole plan, not only this item
page. Never merge pages/timing across revisions; restart on revision change.
Missing item entries mean unknown/unavailable or ineligible, never elapsed zero.
Groups, nonworking tasks and closed plans have no entries. An empty object does
not assert that no work occurred. Timing derivation does not use contributions or
the latest report age as a substitute for an interval boundary.

`exact`: `since` is the first reported-working snapshot after creation or the most
recent inactive/absent/non-task/nonworking boundary. Repeated working, assignment,
relay, links, unrelated changes and redundant active reopen are neutral.
`lower-bound`: `since` is only the earliest verified working snapshot within the
bounded scan. Say “Observed in progress by …; start unknown” and “at least …”, not
“Reported in progress at …”. An exact entry may use that latter absolute label.
This is reported progress, not CPU/token/model time or proof of continued activity.

Anchor elapsed to `readAt - since` when receiving the response, then advance with
a local monotonic receipt-time anchor. Preserve that anchor during cached revisits
and repaints. Do not subtract server timestamps from browser wall time. New replies
provide fresh server anchors; network transit makes the display approximate.
Reject invalid/future times rather than inventing zero. Missing, contradictory or
invalid history produces no start claim; a valid capped suffix yields only a lower
bound. Closed→reopen, blocked→working and remove→re-add reset the interval.

Envelope includes persistent random storeId, source descriptors, captureEnabled,
recorded-only coverage and diagnostic codes. `sourceBinding:{sourceId,verified}`
identifies the service's explicitly configured local source, or null/false when
unbound. Each `sources[]` descriptor also has a distinct verified boolean.
Source verified=false prohibits cross-session linking; it is not inferred from a
project directory or account label. Navigation additionally requires that the
plan's source matches the verified service binding AND current host SDK coverage;
other-source plans stay readable without navigation. Cache by host generation,
storeId and sourceBinding, not a path/account label.
PlanSummary has stable id/source/session, title, revision, structuralRevision,
explicit lifecycle, reportedAt, authoritative last-reported directory/project,
counts, working item IDs and DocumentRef. Items/contributions never inflate each
other. Counts exclude groups and skipped tasks from total, count skipped
separately; remaining=total-done. No age/activity-based completion or failure.

A session move preserves plan identity and recorded contributions. Last-reported
location is metadata, separate from the bound document path. A document left in
the old worktree remains the source; following a relocated file requires an
explicit new binding, never silent path rewriting.

DocumentRef distinguishes unbound/captured/denied/missing/moved/oversized/non-text/
unavailable/changed-during-read. Last valid capture stays referenced on failure,
never relabeled current. checklistSynchronized marks a confirmed matching
checklist/capture; currentFile=not-rechecked honestly describes between-report
coverage. Body text is fetched only on demand and rendered as untrusted plain text.
capturedAt records when the bound document was captured and can be older;
checklistSynchronized is the current-match guarantee, not the capture timestamp.
Show the last successful capture time separately from the last check time. Reports
recheck the bound file under the same bounded permission rules; between checks,
the current file remains unverified. Age alone does not establish a mismatch.

## Mapping for the progress views

- Owner is `PlanSummary.sessionId` (no ownerSessionId alias). Lifecycle is
  active/finished/cancelled/failed; map finished to the UI's completed label.
- List is `data:PlanSummary[]`, NOT old `plans`. No item arrays or document text
  inline. Use server `counts/working` for list summaries and selected `/v1/plan`
  paged items/contributions for full detail. Keep sourceId with every plan key.
- Item fields: id/title/kind/status/parentId?/dependencies?/assigneeSessionId?/
  reporterSessionId?/blocker? (see Reported blockers revision 1). Group rows never count. Contributions have revision,
  reporterSessionId/reporterAgent/attributedSessionId, direct|parent-relay mode,
  `itemIds[]` and reportedAt; map plural IDs without adding work to denominators.
- Document source is `document.path` (not source.path); capture time/hash/ID and
  checkedAt are separate. Use state for denied/missing/moved/etc, and
  checklistSynchronized for matching-checklist certainty. currentFile always
  says not-rechecked between reports; never infer out-of-sync from age alone.
  A retained capture may still have body text when the latest read failed.
- directory/projectId are last reported metadata, not live SDK project labels.
- Production panel ID intentionally STAYS `agent-progress-probe`; no change to
  ui/shared/config.ts is needed. Manifest titles are Agent progress. Companion
  plugin/skill ID is agent-progress; those IDs are independent of the panel ID.

## Frozen setup/control routes

`GET /v1/setup` -> SetupRead from shared/progress.ts:
configured, verified, installed, captureEnabled(boolean|null), targets({configRoot,
dataRoot,storeRoot}|null), version(string|null), activation, separateLifecycle=true,
historyRetained=true, diagnostics[], optional recovery counts. No tokens.

### Frozen additive companion comparison (consumed by the setup UI)

Existing setup reads and action replies produced by `status()` may add:

```ts
interface CompanionUpdateRead {
  state: 'current' | 'available' | 'newer-installed';
  candidateVersion: string;
  rootVersion: string | null;
}
// SetupRead gains: update?: CompanionUpdateRead
```

`version` remains the verified manifest's selected immutable release version, never
the root package version. `candidateVersion` is the bundled payload's release
version. Comparison is present only for configured, verified, installed ownership
with an available validated store and bundled payload. Unconfigured, removed,
unverified, modified, store-error or unknown states omit it; absence (including
older services) makes no claim, and must not be rendered as “up to date”.

- `current`: the active selection equals the candidate identity derived by the
  actual update path: existing binding with candidate version, plugin and guidance
  bytes, file hashes and canonical release digest. Equal version labels alone do
  not establish this.
- `available`: identity differs and candidate semver is greater than or equal to
  selected semver. Same-version rebuilds must not be described as “newer”.
- `newer-installed`: identity differs and selected semver is greater. Warn about
  a possible downgrade, not a normal upgrade; only explicit review/confirmation
  can select the bundled payload. Detection never switches anything.

`rootVersion` is the verified root package.json version (or null if unavailable),
diagnostic metadata for the retained initial loader/removal utility. Update keeps
root files unchanged; their version can intentionally lag the selected release.
Do not claim the root utility was updated. No routes, request bodies, fixed error
codes, protocol/schema2 or database schemas change. POST inspect retains its
existing target-review shape; mutating action replies use the new status snapshot.

Comparison and activation are independent: `current` may coexist with
`reload-required`. Only the matching latest loaded observation clears activation,
not candidate detection. Last observed does not mean every running session is
current. Detection uses existing setup-read occasions, never progress polling;
the full mutation ownership/store/descriptor checks are still performed afresh.

### Frozen additive setup suggestions (consumed by the setup UI)

Only the existing `GET /v1/setup` may additionally return:

```ts
interface Suggestion { value: string; state: 'resolved' | 'candidate' }
interface SetupSuggestions {
  configRoot: Suggestion | null;
  dataRoot: Suggestion | null;
  storeRoot: Suggestion | null;
}
// SetupRead gains: suggestions?: SetupSuggestions
```

This object is present only when unconfigured on Linux or supported Windows; omit it once configured
or on unsupported platforms. `null` means unknown for that field; old services
omitting the entire object remain valid. `resolved` means the service observed an
owned directory without a symlink alias. It does **not** identify effective
OpenCode scope or verify source identity. `candidate` is a host-derived default,
including missing/inaccessible/foreign/non-directory/aliased candidates, not an
accepted target. Inspect remains authoritative for validation.

Host-side inputs are HOME/XDG_CONFIG_HOME/XDG_DATA_HOME and, on Windows when HOME
is absent, the host runtime's homedir result. Absolute canonical XDG bases take
precedence; otherwise append opencode to the home-relative .config and
.local/share directories. Missing Linux HOME with no corresponding XDG hint
yields null; an invalid relative/traversing override also yields null, never a
cwd-based guess. No browser/project/binary inference, search, config/auth content
read or CLI launch. Windows does not substitute APPDATA for OpenCode's roots.
Filtered-out OpenCode overrides cannot be ruled out even when a candidate is observed.

storeRoot is `<dataRoot.value>/openchamber-progress` and inherits dataRoot.state.
That is derivation provenance, **not** a claim that the child exists or has0700;
the child is not probed for suggestions. Unknown data yields unknown store.

Suggestions never set targets, verified, sourceBinding or persistent selection.
They are absent from POST replies. POST shapes, confirmation, fixed error codes,
active tool and protocol/schema2 are unchanged. Opening/inspecting writes no
setup-target directory, payload, descriptor or DB. Existing service-owned selector
bootstrap is outside that target-only promise.

UI precedence is configured targets > user edits > suggestions; deliberately
cleared fields count as edits. All three fields stay editable. Late hints,
refreshes and failed inspect replies must preserve edits, especially a manually
chosen store folder.

`POST /v1/setup/{inspect,install,update,disable,enable,remove-capture}` accepts JSON
with ONLY `{configRoot?,dataRoot?,storeRoot?,confirmed?:boolean}`. Supply all three
roots or none. None uses the current configured descriptor, never ambient guesses.
Inspect is non-mutating; mutating operations require confirmed=true. The UI must
show resolved targets, privileges and separate capture lifecycle BEFORE that
explicit confirmation. Confirmation of local source binding is not inferred from
shared project paths. Controls may not silently switch targets; install/update is
the explicit reconfiguration path. No user-supplied payload, binding-file path,
command, SQL, URL or download. Payload comes only from built package entries.

Reply is SetupRead plus action. Install/update activation=reload-required means
selected files lack a matching loaded-tool observation, NOT activation proof.
An unchanged already-observed payload does not create a new pending reload.
Reload is never automated against a real
instance. SetupError replies are `{error:fixed-code}` (400 for missing confirmation
or unverified targets,409 for ownership/collision/modified payload); malformed
body400, request above16,384 bytes413, store errors503. Unknown query/path404.
Missing binding is an explicit setup state. The service persists only its owned
descriptor after install; a foreign/modified descriptor is never overwritten.
The default authoritative descriptor is in product-owned XDG state outside the
extension package. A valid legacy in-package descriptor is a migration/default
only when stable state is absent; stable state always wins. See docs/setup.md.

Configured store availability is independent of descriptor ownership. A valid
descriptor with an unreadable store remains configured=true with retained targets,
captureEnabled=null and the existing fixed store diagnostic (for example storage,
corrupt or schema). Health/reads return503 instead of an unconfigured success.
Health/setup/read requests each make one bounded open/validation attempt so a
restored store recovers without restarting; no automatic mutation or retry loop.
Pending reload survives a service restart. After successful tool/skill/RPC setup,
the producer records its exact loaded binding/version and plugin/guidance hashes
in optional store metadata scoped by source/install. Setup compares the most
recent observation to the current verified selected payload; a match clears the
notice using the existing control-applies-to-loaded-instances activation value.
Changed same-version files, a new install, or an update/rollback after another
payload was last observed require a fresh matching observation. Neither service
restart, semver alone, nor a historical observation drops genuine pending work.
This is last-observed payload evidence, not a live census of every OpenCode
process/location. No HTTP acknowledgement route or DTO/code-string change exists.

## Active tool

`agent_progress_report`, namespace agent_progress, codemode:false; guidance id
agent-progress. Input Request / REPORT_SCHEMA in shared/progress.ts. Mutations
require plan, oid and rev (start rev0). Receipt `{plan,rev,structuralRev,changed?}`;
errors `{error,rev?,hint?}` (safe optional hint only for invalid tool requests).
Read without page returns compact plan/revision/lifecycle/
counts/documentState/detailPageSize without items; explicit 0-based page returns
paged PlanRead+Envelope.
Caller/source/time are supplied by plugin, never trusted from model input.

- start: title/items/source?; creates independent plan identity.
- change: changes[{id,status}], attributed? (explicit validated parent relay).
- revise: title/items/reopen?; preserves status for retained IDs unless supplied.
- stage: upload/chunk/items, max50 items per chunk, chunk0..31. Durable chunks
  alone do NOT publish a plan or alter its revision. A closed plan requires
  coordinator reopen=true on staging AND commit; staging itself keeps it closed.
- commit: upload/chunks/title?/reopen?; requires all numbered chunks and rev;
  publishes the complete new/revised structure atomically. New plan needs title.
- link: child/assign item IDs; empty assign unlinks. Parent structure/finish only;
  children may change assigned tasks only. Relays explicitly name attributed child.
- bind: source path/confirm?; source path stays bound across directory moves.
- finish: outcome finished/cancelled/failed. Finished requires actionable work and
  no unresolved tasks; all-skipped/empty cannot imply success. Late writes refuse;
  intentional continuation requires coordinator revise/commit with reopen=true.

Same oid+same caller/session+same semantic input returns the ORIGINAL receipt;
altered reuse refuses, stale rev returns current rev. Batches are all-or-none.
Ancestry is authoritative or unknown, never guessed. History retained by default.

## Adopted bounds / compatibility

16,384-byte requests;262,144-byte full document captures;20 default/50 max page
size;1000 items/plan;32 chunks,50 items/chunk;1MiB service response ceiling.
Large plans require explicit chunk commit; no truncation-as-complete. Routine
status request/receipt token targets250/100 are tuning estimates, not rejection
rules. No token billing or exact tokenizer measurement is implied by estimates.
Schema/protocol mismatch fails closed; independent component rollback may not
downgrade stored data. Old probe DBs are not migrated/reset into production.

Backend builds produce service/companion/setup utility entries; package assembly
joins these with the guest bundles to produce the installable extension ZIP.
## Declared delegation and assignment attribution (optional v2 metadata)

`delegate` extends the existing report request with `plan`, fresh `oid`, expected
`rev`, and `assign` (at most 50 unique task IDs). The trusted coordinator may
declare its next supported delegation; an empty array cancels its pending intent
for that plan. Declaration is not assignment, dispatch, progress or completion.
It does not advance a plan revision, refresh report age, capture a document, or
create a durable receipt. The response's `delegation` contains `state`
(`pending`, `reserved`, `retired`, or `bound`), `expiresAt`, `memoryOnly: true`,
`lostOnRestart: true`, and `requires: "supported-next-delegation"`; a bound retry
may include the ordinary assignment `receipt`. Pending declarations and their
retry recognition expire after five minutes and disappear on companion restart.
Re-declare deliberately with a fresh operation ID after restart. Explicit
`link` and assigned parent relay remain the fallback.
Binding is evidence-gated for any installed `subagent` implementation, with no
implementation discriminator, certification gate or policy switch. A matching
before/completed-after hook pair, exactly agreeing one-call native census,
matching parent/assistant-message `session.step.ended`, verified immediate child
and complete ancestry are all required, within the declaration's lifetime and
existing authorization/control guards. Missing or ambiguous evidence retires
without assignment; a pending declaration promises no automatic assignment.
These gates prove call correlation and child lineage, not that the tool actually
created or continued that child: installed tools are trusted to report the child
they delegated to. Slim is covered only through these same gates, not separately
certified. The observed 2.2.25 native-tool wrapper supplies foreground/background
signals; pre-acknowledgement resume lacks a matching result and competing calls
are ambiguous, so those cases do not bind. Post-acknowledgement resume is untested.

Current detail responses may include `items.data[].assignmentBinding`:

```ts
{
  coordinatorSessionId: string; childSessionId: string;
  planId: string; itemId: string; tool: 'subagent';
  messageId: string; callId: string;
  observedAt: string; boundAt: string;
  boundRevision: number; validAtRevision: number;
}
```

This bounded, server-authored metadata attributes the current assignment to a
verified host call. It is not caller input, report attribution, a child update,
evidence of reporting permission, or proof of completion/accepted handoff.
`validAtRevision` must equal the enclosing plan revision; the item, plan,
coordinator, child and current link must agree. Malformed/stale optional metadata
is omitted without rewriting stored history. Absence means provenance unavailable,
not absence of assignment; explicit links and older v2 writers have no such
provenance. Current neutral writers carry only validated current provenance;
explicit link replacement/unlink invalidates it, including a same-child relink.
An older writer's revision cannot certify inherited provenance. The base protocol
and SQLite schema version remain 2. Existing detail pagination and source binding
apply; list/history routes gain no discovery or authorization semantics.
