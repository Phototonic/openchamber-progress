# Production backend v2 (T3)

Current package version: **0.2.6**. Here v2 means protocol/schema2,
not a release major. Owner-corrected historical package labels below are0.2.0
and0.2.1; raw earlier local evidence retains the original mistaken labels.
`evidence/` and `AGENTS.md` are local-only, never committed or packaged. Evidence
references in this guide describe local QA records, not consumer deliverables.

`docs/contracts.md` and `shared/progress.ts` are the frozen Designer contract.
T1 probe DTO/store/scripts are historical fixtures, not a production fallback.
The archived probe HTTP service exists only in tests/fixtures. No UI code is owned
or changed by this backend lane. Panel ID remains agent-progress-probe (stable
openSurface target); companion/skill ID is agent-progress. T5 assembles packages.

## Owners and trust boundaries

- plugin/index.ts registers one namespaced codemode:false report tool and inline
  skill. It gets actual caller IDs/agent from invocation context and refreshes
  authoritative session/location/project/parent metadata on each call. Ancestry
  lookup is bounded32, cycles/errors stay unknown. No activity/message scraping.
- plugin/activation.ts adds advisory native primary-context/post-execute hooks.
  Verified source/session, enabled capture and effective report-tool availability
  are required for guidance. Conditional ownership copy needs only the current
  authoritative session, not ancestry/plan scans. A bounded single-row enabled
  query is sampled at hook boundaries, including after awaited lookup. Reporting
  still performs its unchanged assignment/ancestry/capture checks.
- shared/store.ts owns mutations, counts, assignment/lifecycle validation,
  immutable revision snapshots, operation receipts, source namespaces, captures
  and capture-enabled control. No await/file/network work inside transactions.
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
checks are our enforcement boundary. Strict capture is Linux-only in V1; other
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

## Storage and document consistency

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

## Adopted bounded defaults

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
Restart/cap eviction may lose a hint or permit an old replay; base guidance recurs.
Observed disable drops pending hints and invalidates in-flight lookups, with no
backfill on re-enable. Disposal clears local state before unregistering hooks and
closing Store; setup failures roll back partial registrations and close Store.
No timer, persistent reminder, new RPC or automatic progress/capture write exists.

## Verification and known limits

### U1 official-main metadata checker

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

Frozen DTO/lifecycle meaning: docs/contracts.md. Focused QA-U:

```sh
bun run typecheck
node --experimental-strip-types --test tests/backend/extension-updates.test.ts
```

Tests use real authenticated service HTTP plus real loopback metadata HTTP, with
logical fixed-target assertions and no live GitHub/private authentication. They
cover coalescing/cache/ETag/provider failure, validation/semver, bounded redirects/
body/deadline/shutdown, store independence and unchanged fixture selection/config/
DB bytes. Local evidence: evidence/release-checks-live-status/updates-http.txt.
An ignored runnable loopback-only fixture with companion/setup siblings is handed
to Designer for U2. No current installed companion or real setup roots are touched.
Final stable-input package/Git-distribution joins remain P1/D1, not U1 acceptance.

### T1 reported-working interval reader

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

QA-T commands (Node24 available through the local version-manager bin directory):

```sh
bun run typecheck
node --experimental-strip-types --test tests/backend/task-timing.test.ts tests/backend/production-service.test.ts tests/backend/production-storage.test.ts
```

These checks use actual Store writes, a controlled clock, authenticated HTTP,
replay, neutral link/relay/structure changes, reset boundaries, cap/byte-budget and
isolated corrupt snapshots, paging/concurrent commits, store/source isolation and
closed-handle recovery. Evidence: evidence/release-checks-live-status/timing.txt.
The ignored isolated service fixture for Designer includes copied companion/setup
siblings. This is not final package/distribution or browser acceptance; P1 performs
the final stable-input build and companion byte-identity join.

### U1 companion comparison / frozen U2 seam

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
read-only service. U1 is not package/release acceptance. The owner now reports no
issues on0.2.4 and lifts the prior performance hold for PR preparation, without
establishing the earlier slowdown's cause. No real-user operation is part of
these fixture checks.

### T7 host-side setup suggestions / frozen T8 seam

`shared/progress.ts` adds Suggestion/SetupSuggestions and optional
SetupRead.suggestions, populated only by existing GET /v1/setup while unconfigured
on Linux. `service/suggestions.ts` reads only allowlisted host HOME/XDG config/data
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
cache was introduced. See docs/contracts.md for the frozen field names and T8
edit-preservation precedence.

QA8 runs real authenticated HTTP with fixture HOME/custom XDG, missing/partial/
invalid hints, unsupported host, symlink/foreign-UID/non-directory candidates,
permissive store and configured binding. It checks fixture bytes/mtime unchanged
on GET/inspect and verifies discovery reads no contents or child-store metadata.
Foreign UID is scoped stat injection, not privileged chown. A separately compiled
service smoke test uses a fresh allowlisted HOME with a different cwd and no model.
The existing21 setup regressions are retained, including all7 normalization tests.
No owner's actual installed invocation is claimed as diagnosed by those fixtures.

Source-only command/evidence:

```sh
node --test tests/backend/setup-suggestions.test.ts tests/backend/setup-paths.test.ts tests/backend/production-setup.test.ts tests/backend/production-service.test.ts tests/backend/service-recovery.test.ts tests/backend/service-lifecycle.test.ts
```

Local evidence is under evidence/backend/setup-suggestions* (ignored, not shipped).
T8 consumes a separately built service fixture after parent acceptance; T9 alone
joins packaging. No UI, release-version or protocol/schema change accompanies T7.

QA2 contract tests cover fixture P1/P2/P3, relay counts, atomic invalid batches,
conflicts/replays, assignment/closed/reopen/finish variants, move history, chunks,
pagination, Unicode document/version capture and denied/moved/oversized reads.
QA3 uses actual production writer processes, trigger pause inside write transaction,
SIGKILL before commit and after commit-before-reply, bounded busy, SQLite page
capacity/read-only write failure, corrupt/future files preserved. Capacity fault
is a real SQLite storage failure, not a full filesystem exhaustion experiment.
QA4 uses real HTTP and disposable setup roots, update interruption, modified files,
symlink/collision refusal, transactional control and history-retaining removal.
The self-contained production companion activates/updates in an EMPTY isolated
OpenCode2.1.4; standalone removal utility controls that loaded instance after
extension absence. No credentials, inference or real-user installation.

Fresh real OpenChamber production-frame/service integration is T4/T5/T6, not
claimed by T3 unit/integration tests. Existing T2 host SQLite evidence is retained.
Slim/model relay/title/generate/wire fallback limitations of T1 remain explicit.
No T5 ZIP/folder assembly, publishing, commits or remote operations were included
in the original T3 scope; later bounded joins are recorded below.

## Accepted-T3 follow-up and T5 artifacts

The paragraph above records the original T3 boundary. The subsequent authorized
fix-then-package dispatch adds service recovery and local package assembly:

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
  backend outputs and unchanged Designer guest artifacts. Package metadata0.2.0
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
normal check that prints actualHostInstaller=not-run. T6 remains unexecuted.

## T6 backend corrections /0.2.1 (supersedes prior default/reload behavior)

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
not (timestamps/headers are not canonical). Designer bundles are copied unchanged.
The original live2 proof applies to the owner-labelled0.2.0 build; no new model run was performed or claimed.
Evidence and migration limits: evidence/backend/qa.md and docs/setup.md.

## T9 /0.2.3 private testing candidate join

Extension/companion metadata moves together to0.2.3; protocol/schema remain2.
Backend outputs include the preserved separator normalization, T7 read-only
suggestions and deterministic Store cleanup on failed plugin setup. The plugin
retains its normal success disposer and original setup errors. The smaller-import
candidate was not promoted; persistent-service Store reuse and payload caches
remain deliberately absent. Designer's accepted F1/F2/T8 guest bundles are copied
byte-for-byte, never rebuilt by backend packaging.

`scripts/verify-package.ts` checks canonical entry inventories, exact folder/ZIP
allowlists, manifest/version agreement, the actual packaged unconfigured service's
suggestions and read-only inspect, installed tool/guidance, lifecycle/history,
stable selector replacement and unavailable-store recovery. The actual host
installer gate uses the explicitly supplied isolated host module and installs the
folder and ZIP into fresh registries, not a real app/configuration.

The separate `scripts/verify-source-package.ts` copies git-visible source into a
new temporary tree without build/evidence/.slim/AGENTS or node_modules; only an
explicit symlink to existing dependencies is provided. It runs typecheck and the
backend build, not a second full test/aggregate suite. This proves no local
evidence/generated-backend dependency for that path, not a fresh dependency install
or the parent's later git-archive/clone gate. No network fetch is required.

Local QA: evidence/package/m2-checks.txt, source-export.txt and canonical entry/hash
inventories; backend acceptance limits remain in evidence/backend/qa.md. Cached
revisit/spinner and bounded latest-switch refresh fixes have accepted Designer
evidence; failed-setup connection cleanup has focused runtime regressions. None
establishes the owner's hours-long real-host sluggishness cause. This is an
unreleased private testing candidate, not a release-ready or complete-cure claim.

## Companion upgrade UX /0.2.4 private candidate join

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
no real0.2.4 install/reload or new performance claim is authorized or implied.
