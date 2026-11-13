# Design

## Context and evidence

`docs/contracts.md` and `docs/ui.md` define source-qualified identity, complete detail, reported-only progress, privacy and readiness. Existing summary generation is pure but lives under the UI, has no total character bound, and deliberately preserves an exact legacy English format. `readDetail` validates store/binding/key/revision/cleanup across every item and contribution page; it permits 120 pages and three revision restarts. `Store.detail` uses the existing read transaction; calling the HTTP detail route also derives timing that summaries do not need.

`Store.list` supplies bounded output pages and session membership through ownership, current links and recorded contributions. Its SQL output limit is not a bound on all scanned or parsed input. The newer `shared/plan-task-search.ts` already owns keyset traversal, pre-materialization byte admission and bounded snapshot validation. Reuse that machinery for typing-time reads rather than fetching detail or multiplying unbounded list scans.

Pinned external references:

- [SDK 2.7.0 service contract](https://unpkg.com/@openchamber/sdk@2.7.0/GUEST_SERVICES.md), [constants](https://unpkg.com/@openchamber/sdk@2.7.0/dist/service-host.js) and [row schemas](https://unpkg.com/@openchamber/sdk@2.7.0/dist/service-host-schemas.js): search 2 seconds, resolve 10 seconds, 20 rows, 120-character titles/subtitles, 256-character IDs and 16,000-character resolved text.
- [SDK 2.7.0 background contract](https://unpkg.com/@openchamber/sdk@2.7.0/README.md): fresh hidden frame per action, synchronous handler registration, awaited work, 20-second invocation budget, pinned clicked-session context, teardown on completion or authority loss.
- [2.5.1 parser](https://unpkg.com/@openchamber/sdk@2.5.1/dist/parse.js): non-strict contribution object, background entry and session/background action support. No mentions field; unknown contributions are dropped. [2.7.0 changelog](https://github.com/openchamber/openchamber/blob/651a0564880633fbcdc2ac3f84d08e42c7748a64/CHANGELOG.md) advertises `@` rows; background actions first appear under 1.24.1. The published 2.6.1 parser has no mentions field.
- [OpenChamber 2.7.1 release notes](https://github.com/openchamber/openchamber/releases/tag/v2.7.1) add **Mobile: extensions work on the phone**. Release 1.2.0 adopts this host floor; earlier parser tolerance is historical evidence, not a promise of installation support.
- [Pinned host frame](https://github.com/openchamber/openchamber/blob/651a0564880633fbcdc2ac3f84d08e42c7748a64/packages/ui/src/components/layout/PluginPane.tsx) pins the action's source context but calls global `setPendingInputText(text, mode)` for compose. [Pending composer consumer](https://github.com/openchamber/openchamber/blob/651a0564880633fbcdc2ac3f84d08e42c7748a64/packages/ui/src/components/chat/composer/state/usePendingComposerText.ts) appends with line breaks. This is not a targeted-session draft API.
- [Pinned mention consumer](https://github.com/openchamber/openchamber/blob/651a0564880633fbcdc2ac3f84d08e42c7748a64/packages/ui/src/lib/guests/mentions.ts) resolves when picked and stores the returned text on the chip. Some service comments describe send-time resolution; the actual consumer and real-host acceptance take precedence over those comments.

These are source/documentation observations, not a claim that this feature has passed host QA.

## Decisions

### 1. One summary owner, two presentation profiles

Move the pure formatter into `shared/`, extracting only the data types, fixed summary text and pure readiness dependency needed to remove runtime imports from service/shared code into UI code. Keep existing UI entry functions as thin exports/adapters where useful. Reuse the same dependency/readiness decision owner; do not reproduce readiness rules in a service formatter or pull the frame controller/SDK UI into the backend.

The existing preview profile retains its English/Russian formatting, final newline, pending-ten-row convention, privacy selection and historical summary-only flow. The composer profile uses the same section/task/prerequisite generation, adding:

- source-qualified plan key, current matched revision and absolute UTC **Reported as of** time from the report, never the current clock;
- an explicit **Reported progress, not verified completion** qualification, **Review before sending**, and source-verification warnings where applicable;
- a bound of 16,000 JavaScript string code units, including headers, qualification, warnings, selection context and omission marker;
- whole task rows only. Reserve fixed metadata and an omission footer first; keep deterministic section/stored-item order. Count eligible task rows withheld by the pending-row limit or character budget once, and report **N tasks omitted from these sections**. Do not count tasks intentionally outside a format as truncated rows. Never cut a title, prerequisite row or safety sentence to make a successful summary fit. An unfit row is omitted whole. A suggested-next-step row is optional under the budget, not a second task count;
- no leading/trailing whitespace in the composer result, so host trimming cannot silently change the string. Legacy preview newlines remain unchanged.

The composer profile's source-qualified key is a deliberate new disclosure of the source namespace, required to disambiguate plans. It is not a source-root path or reporting authority. The existing preview's narrower identifier policy is unchanged. Continue omitting document bodies, transcripts, tool output, blocker details/provenance/timing, source roots, paths, hashes and raw diagnostics. Fixed freshness warnings remain permissible. Recorded titles can contain sensitive or misleading content: literal escaping and data-only framing are not secret redaction or prompt-injection prevention.

### 2. Complete input, explicit refusal

The service resolves one source-qualified key using the existing Store/detail owner and a bounded complete-read assembler, not an internal loopback request and not a captured-document read. Reuse/extract the same pure identity and normalization checks used by guest detail reads. Do not derive working/blocked timing for resolution. Keep item and contribution completeness, store/binding/key/revision/cleanup agreement and bounded restart semantics. Enforce an overall resolve deadline below the host's 10 seconds; a completed snapshot is an as-of observation, not freshness after delivery.

Background actions reuse the existing guest scoped-list and detail readers, with invocation retirement/deadline checkpoints between awaits. Only complete current matching detail can enter either composer format. Failed continuation, exhausted limits or identity changes produce a plain refusal, not list-row substitution or implicit historical fallback. Existing previews retain their explicit historical fallback. Archived/deleted targets return 404 from mention resolution even though archival detail remains inspectable in existing views.

### 3. Search is a bounded plan-summary projection

Implement a narrow internal plan-summary search on the existing Store connection, reusing the search helper's admission/matching machinery. Keep the public `/v1/search` contract unchanged. It matches each plan's own title or ID, not task text, document content or a union of unrelated entity fields. Reuse normalized token matching; empty query admits candidates. Do not emit one candidate per task or invoke detail/history/timing reads while typing.

Initial execution bounds: at most 512 raw plan slots, 1 MiB per accepted snapshot and 16 MiB total accepted snapshot input per request, with the existing 1,000-item snapshot validation. A cooperative 500 ms scan budget stops between bounded steps; the existing SQLite busy ceiling is separate and not a hard real-time guarantee. No persistent index/cache, job, continuation token in the host menu, new Store lifetime or source filesystem discovery is needed. Disconnected requests cease further work at a checkpoint. Never retain query text in logs.

Collect/rank accepted candidates and emit at most 20 distinct keys. Priority is normalized current-directory match, then the same recorded project when an unambiguous project association can be established from matching directory records in the verified bound source, then other locations. Within each locality class: active before closed, latest report first, binary source-qualified key as tie-break. Do not infer project membership from path prefixes, similar names or another source's session ID. Missing/ambiguous project metadata falls back to directory ranking, not a host-wide project scan.

Results describe found candidates, not a complete library census. When the scan ends at a work/input bound, preserve a compact **Limited search** qualification in subtitles; an empty bounded result makes no no-plans claim. Backend failures remain errors so the host contributes no rows. On the representative approximately 450-plan/1,700-task store the normal search should finish with headroom under the host deadline, including rapid concurrent requests; measured evidence is required before shipping.

Use SDK route/limit constants. Row IDs are `${sourceId}/${id}`; never abbreviate them or use titles as identity. Flatten titles as literal text and shorten only menu display titles to the SDK's 120-code-unit limit with a visible ellipsis, without splitting Unicode surrogate pairs. Reserve subtitle space for progress/lifecycle and **From another OpenCode setup** / **Unverified OpenCode setup**, following board binding and recorded-verification rules. Omit `url`: no guessed session navigation or local path link.

### 4. Additive authenticated service routes

Add ready-health `planComposerHandoff:1`; protocol/schema stay 2. Routes remain behind the existing bearer, loopback, fixed-error and no-store response boundary:

| Route | Request | Success |
|---|---|---|
| `POST /mentions/search` | JSON `{query:string,directory:string|null}` | `{items:[{id,title,subtitle}]}` |
| `POST /mentions/resolve` | JSON `{id:string}` | `{text:string}` |

Reject unknown body keys, URL query parameters, malformed JSON/UTF-8, wrong methods and over-limit bodies. Reuse the 16 KiB request ceiling; search query accepts at most 200 code units (the pinned host forwards at most 200), directory at most 4096 without NUL, and identifiers use the existing source/plan identifier grammar with exactly one separator. Directory is only ranking input, never a file-access request. Errors remain fixed codes: 400 invalid, 401 unauthorized, 404 not-found (including archived resolve), 405 wrong method, 413 oversized body, 409 identity/revision conflict, 503 store/unavailable/incomplete-read. Document these POST reads as the deliberate exception to the generic GET-read description. Older consumers ignore the additive health capability; new background consumers refuse unsupported service capability instead of fabricating an empty result.

### 5. Session choice and active-draft delivery

Declare two session actions with `mode:"background"` and no `payload`. One `background/index.html` and built classic script handles them; no extension panel is opened. Register `host.onAction` immediately after connection and await reads, compose and toast before returning.

Use `item.kind === "session"` and its session ID, never the current visible session or title, for `/v1/plans?session=...`. Pin all accepted pages to the same store/binding. Session identity in a different setup is not proven by a same-spelled ID: automatic handoff requires the verified bound source and matching recorded-source verification. Other/unverified sources remain available for explicit selection through mentions/board, not silently chosen by a host-session action.

Read the existing `rail-plan:<sessionId>` preference in its current storage scope without modifying it. A source-qualified saved choice is usable only if it is in the complete visible bound-source session result. Otherwise use the existing automatic featured-plan rule: latest active plan with working task IDs, then owned-first active/recent scoped ordering, with stable key ties. A missing/stale preference permits this fallback; a failed preference read does not pretend absence and instead explains that the saved choice could not be read. A capped/failed list cannot establish no plans, uniqueness or an exact other-plan count and therefore refuses insertion. A changed/deleted/archived selection during detail loading refuses rather than silently substituting another plan.

With multiple plans, include the selected plan identity and **N other plans reported for this session; only this plan is included** in the bounded text. A complete empty result toasts **No plan reported for this session**. Fixed plain-language messages cover unavailable setup/service, unsupported capability, incomplete reads and denied permission; never display raw errors.

Call only `host.compose({text,mode:"append"})`. The approved destination is the active chat when the host consumes the request, even if it differs from the menu's source session or changes during preparation. Do not navigate, open sessions or claim destination-session pinning. Toast **Added to the active chat. Review before sending.** after successful compose acknowledgement. Existing draft text remains intact. A lost acknowledgement has an uncertain insertion outcome: do not retry automatically or claim nothing changed.

The host owns the short-lived hidden frame. No polling, workspace subscriptions, persisted background state or summary cache is added. Disable, permission withdrawal, runtime changes and disposal retire remaining work; already accepted draft text cannot be retracted. Concurrent typing queries share no mutable selection; action invocations do not use a global extension-side selected-plan singleton.

### 6. Language, compatibility and distribution

Existing previews remain unchanged. The background entry reads the existing effective language once through the feature-gated device preference helpers, without starting the UI refresh loop or writing preferences. Fixed errors use the same locale fallback rules. Mention requests have no language/device context, so English is the approved service default; no server preference bridge or cross-device last-language cache is introduced. Manifest section/action labels are fixed host-owned labels.

Release 1.2.0 sets `engines.openchamber` to `>=2.7.1`, replacing the policy of raising the floor only as far as individual features need or relying on older hosts to ignore unknown keys. The rationale is 2.7.1's mobile extension support and the fact that available host evidence is 2.7.1 only; this does not add mobile-specific UI or claim phone certification. Keep the SDK dependency pinned at 2.7.0 unless separately authorized. Verify that the candidate installs on an isolated 2.7.1 host and that a host below 2.7.1 refuses installation with its normal version message, using the actual unmodified older installer where available. Record unavailable older-installer coverage honestly; SDK parsing alone does not prove installer behavior. Compatibility with other independently added manifest contributions must be checked at integration, not assumed here.

Build the background script with the existing guest bundler. Add its HTML/script to extension packaging, package verification, Git-distribution entry checks and generated-entry parity; include its TypeScript in UI typechecking. Update contributor instructions instead of editing CI workflows. Regenerate affected service and guest bundles only, preserving unrelated companion/setup outputs unless their inputs actually changed.

## Failure modes and rollback

Adversarial literal titles, massive task rows, source-ID collisions, cleanup races, partial reads, permission loss and active-chat changes need focused behavioral checks. No privileged text is interpreted or executed, but a user choosing agent-authored context still has to review it. Review this data-to-agent boundary explicitly; additional security consultation is warranted if implementation broadens accepted content or authority.

This is a no-migration read feature. Reverting its manifest contributions, source, package inventory and affected built outputs removes new entry points without touching reports, capture state, preferences or schema. Feature rollback does not lower release 1.2.0's `>=2.7.1` host floor. Existing draft/chip snapshots already delivered belong to the host and are not recalled. Do not reset the store, downgrade run storage or change companion setup to roll back this feature.
