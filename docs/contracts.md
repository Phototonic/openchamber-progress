# Frozen production contract v2 — T3 / Designer handoff

Private testing candidate **0.2.4** (unreleased) is independent of protocol/schema **2**. Setup's version
and the loaded tool's version report package semver; /health protocolVersion and
schemaVersion remain contract versions, not package-major aliases. Local QA under
evidence/ and project instructions AGENTS.md are never committed or shipped.

Canonical DTO: `shared/progress.ts` (protocolVersion=2, schemaVersion=2).
Announced before shared changes. Only Heavy Fixer owns shared files; consumers
must switch sequentially. The old `shared/contract.ts` ProbeRead is historical
fixture code, never a production fallback. UI implementation is Designer-owned.

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
SDK coverage. Navigation must be verified by Designer against the CURRENT host.

## DTO meanings

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

DocumentRef distinguishes unbound/captured/denied/missing/moved/oversized/non-text/
unavailable/changed-during-read. Last valid capture stays referenced on failure,
never relabeled current. checklistSynchronized marks a confirmed matching
checklist/capture; currentFile=not-rechecked honestly describes between-report
coverage. Body text is fetched only on demand and rendered as untrusted plain text.

## Frozen mapping for T4 Designer

- Owner is `PlanSummary.sessionId` (no ownerSessionId alias). Lifecycle is
  active/finished/cancelled/failed; map finished to the UI's completed label.
- List is `data:PlanSummary[]`, NOT old `plans`. No item arrays or document text
  inline. Use server `counts/working` for list summaries and selected `/v1/plan`
  paged items/contributions for full detail. Keep sourceId with every plan key.
- Item fields: id/title/kind/status/parentId?/dependencies?/assigneeSessionId?/
  reporterSessionId?. Group rows never count. Contributions have revision,
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

### U1 frozen additive companion comparison (U2 consumer contract)

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

### T7 frozen additive setup suggestions (T8 consumer contract)

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

This object is present only when unconfigured on Linux; omit it once configured
or on unsupported platforms. `null` means unknown for that field; old services
omitting the entire object remain valid. `resolved` means the service observed an
owned directory without a symlink alias. It does **not** identify effective
OpenCode scope or verify source identity. `candidate` is a host-derived default,
including missing/inaccessible/foreign/non-directory/aliased candidates, not an
accepted target. Inspect remains authoritative for validation.

Host-side inputs are only HOME/XDG_CONFIG_HOME/XDG_DATA_HOME. Absolute canonical
XDG bases take precedence; otherwise use HOME/.config and HOME/.local/share,
appending opencode. Missing HOME with no corresponding XDG hint yields null; an
invalid relative/traversing override also yields null, never a cwd-based guess.
No OS-home fallback, browser/project/binary inference, search, config/auth content
read or CLI launch. Filtered-out OpenCode overrides cannot be ruled out, even
when a candidate directory is observed. Current support remains Linux-only.

storeRoot is `<dataRoot.value>/openchamber-progress` and inherits dataRoot.state.
That is derivation provenance, **not** a claim that the child exists or has0700;
the child is not probed for suggestions. Unknown data yields unknown store.

Suggestions never set targets, verified, sourceBinding or persistent selection.
They are absent from POST replies. POST shapes, confirmation, fixed error codes,
active tool and protocol/schema2 are unchanged. Opening/inspecting writes no
setup-target directory, payload, descriptor or DB. Existing service-owned selector
bootstrap is outside that target-only promise, not newly changed by T7.

Designer precedence is configured targets > user edits > suggestions; deliberately
cleared fields count as edits. All three fields stay editable. Late hints,
refreshes and failed inspect replies must preserve edits, especially a manually
chosen store folder. No T8 UI implementation is included in T7.

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
errors `{error,rev?}`. Read without page returns compact plan/revision/lifecycle/
counts/documentState/detailPageSize; explicit page returns paged PlanRead+Envelope.
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

Existing Designer entry paths and package manifest remain unchanged for T4/T5.
T3 builds backend/companion/setup utility, not the installable extension ZIP.
