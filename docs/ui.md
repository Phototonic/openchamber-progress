# Progress views (T4, Designer)

Three guest frames read the frozen production contract v2 (`shared/progress.ts`,
`docs/contracts.md`) through `host.serviceRequest`.
- Built from `@openchamber/sdk/ui` and host theme tokens; TypeScript source, classic IIFE bundles.
- The plan (`.slim/plans/agent-progress.md`) owns behaviour; this file records the UI's structure and decisions.

## Build and checks

```sh
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
node_modules/.bin/tsc -p ui/tsconfig.json --noEmit
node --experimental-strip-types --test tests/browser/*.test.ts
bun run bundle:guest ui/panel/main.ts ui/panel/main.js   # same for status, page
```

Entries `ui/{panel,status,page}/index.html` load `main.js`, the generated installable artifact. There are no runtime dependencies, remote assets or CDN loads. The panel ID stays `agent-progress-probe` (`ui/shared/config.ts`), so Work Status can open the rail with `openSurface('plugin:agent-progress-probe')`.

## Layers (`ui/shared`)

| Module | Role |
| --- | --- |
| `adapter.ts` | **Only** module that knows the wire format. Validates and maps v2 replies: `/health`, `/v1/plans`, `/v1/plan`, `/v1/document`, `/v1/history`, `/v1/setup`. Builds query and setup bodies. Protocol/schema ≠ 2 fails as incompatible. |
| `model.ts` | View model and pure semantics. Plan summaries use server `counts`; detail subtrees use the shared `countItems` (same rule). Hierarchy, current work, participants, document-state copy. |
| `source.ts` | Paged reads through the host proxy (rules under v2 mapping below). Classifies fixed error codes into plain states. |
| `live.ts` | SDK workspace enrichment: one projects stream plus capped session streams. Coverage, live-state labels, navigation gating (`canOpen`), and `restart()` after a context change. |
| `scope.ts` | Server list scope per surface, owned-first ordering, page project/worktree grouping, coverage gap. |
| `setup.ts` | Setup UI, phases, plain-language SetupError and diagnostic text. |
| `app.ts` / `refresh.ts` | Frame lifecycle, caches and repaint rules (under Controller below). |
| `components.ts`, `style.ts`, `format.ts` | DOM pieces, CSS from host tokens only, locale-aware time. |

## v2 mapping (frozen contract → UI)

- **List.**
  - Each `data[]` row is a `PlanSummary`.
  - The plan key is `${sourceId}/${id}`; the owner is `sessionId`; `finished` displays as "Finished".
  - List rows and summaries use server `counts` / `working` only.
- **Rail and Work Status.**
  - Read `/v1/plans?session=<ctx session>`, or `?directory=<ctx directory>` when there is no session; with neither, the view is unscoped.
  - The server's filter includes participants (links, assignments, attributed contributions), so a child session sees the plan it works on, with a "contributes to a plan from …" note.
- **Page.**
  - Reads all plans (`limit=50`, cursor pages up to 10).
  - The session filter goes to the server (`session=`); project/worktree narrowing is local, from the recorded `directory` plus live SDK labels.
- **Detail** (`/v1/plan`) loads on demand for the shown plan only.
  - Items and contributions page with one cursor: each nested `nextCursor` is passed back verbatim, and reading stops when both are null.
  - If `plan.revision` changes between pages, the read restarts.
  - Contributions use `itemIds[]` and never change counts. Relays show "Reported by <reporter> for <child>".
- **Document** (`/v1/document`) loads on demand, when the disclosure opens or the Document tab is shown.
  - Continuation pages pin the first reply's `captureId`.
  - States (`denied`, `missing`, `moved`, `oversized`, `non-text`, `unavailable`, `changed-during-read`) get plain copy.
  - A retained earlier capture stays readable, labelled "last successful capture, not the current file".
  - `checklistSynchronized` adds "task list was confirmed against this capture".
  - `currentFile` is always described as not rechecked; age never implies out-of-sync.
  - Continuation pages pin the first page's capture ID, so the text is always one capture. If any page answers `historical-capture` (a newer capture landed mid-read), the body says "A newer capture was recorded while this loaded. This is the earlier capture." The next refresh loads the new capture.
- **History** (`/v1/history`, page tab): oldest-first pages, labelled plan reported / tasks revised / outcome reported / progress update.
- **Health.**
  - `ready:false` is a setup state, never an empty success.
  - `503 {error}` maps to plain states: `corrupt` → damaged, `schema` → incompatible, `busy` → busy, others → service not responding.
- **Navigation.** "Open session" appears only when the plan's `sourceId` equals the verified `sourceBinding.sourceId` **and** the session is in this host's current SDK snapshot. Other plans stay readable with "From another OpenCode setup" and no target.
- **Source identity.** A plan whose recorded source has `verified:false` shows "Unverified OpenCode setup" in its header and an "Unverified setup" (warning) badge in the page list. Details lists every recorded source with its verified flag.
- **Cache identity.** Frame generation + `storeId` + `sourceBinding`. A change resets UI state and the detail, document and history caches.

## Surfaces

**Right rail (`ui/panel`).** Shows the scoped plans; a picker appears when there are several, and plans are never merged.
- The chosen plan is **persisted per session** in host storage (`rail-plan:<sessionId>`), so it survives panel remounts and reloads.
- Reading order:
  1. plan title, location, "Updated …"
  2. large done/total and segmented bar (done / in progress / blocked)
  3. "Now" callout
  4. task hierarchy (groups collapsible, with their own counts)
  5. sessions with live state and verified "Open session"
  6. collapsed plan document
  7. collapsed Details
- Unconfigured service: the setup flow in compact form. After install, a reload notice.

**Work Status (`ui/status`).** Compact, scoped to the section's own session or directory.
- Shows: counts and bar; first working (else blocked) task from the primary plan's detail; age and live state; up to two other plans.
- "Open progress" calls `openSurface` to open the rail. Unconfigured shows "Set up", which opens the rail's setup flow.
- `setHeight` follows content. The frame never writes a badge.

**Fullscreen page (`ui/page`).**
- Project → worktree → session filters; a grouped keyboard listbox (live/lifecycle/"Other setup" badge, done/total).
- Detail tabs: Progress / Document / History. A coverage note covers missing live state, other-source plans and the subscription cap.
- Footer zone: collapsed **Setup**, then collapsed **Details**.

### Diagnostics placement (owner direction, unchanged)

Only the progress story is in the normal reading order. These live in one collapsed **Details** disclosure (`data-testid="details"`): store and plan source IDs, binding (verified or not), every recorded source with its verified flag, capture on/off, coverage value, plan ID and revision (structure), absolute report time, last reported location, document path, state, capture ID, hash and checked time, live-subscription count, last refresh error, and translated envelope diagnostics.
- Placement: at the end of the rail, and in the page footer below Setup. Work Status omits it.
- No fixture or probe labelling appears anywhere.

## Setup UI (`ui/shared/setup.ts`)

Phases come from `GET /v1/setup`: `unconfigured`, `installed`, `disabled`, `reload-required` (install/update reply until the service restarts), `removed`, `recovery` (staged files present). Rules:
- **Prefill (M2/T8).** An unconfigured Linux service may add `suggestions` (`configRoot`, `dataRoot`, `storeRoot`, each `{ value, state: 'resolved' | 'candidate' }` or `null`) to `GET /v1/setup`.
  - The form appears as soon as health says the service is not set up, with "Looking for your OpenCode folders on this computer…" while the reply is pending. Hints fill only fields the user has not typed in; a deliberately cleared field counts as typed.
  - Precedence: configured targets (no form) > the user's edits > suggestions. Late replies, the setup refresh an unconfigured frame does on navigation, and inspect errors never overwrite an edited field. A later unknown (`null`) hint never wipes an earlier prefill.
  - The store suggestion is `<data folder>/openchamber-progress`. While the store field is untouched, it follows a data folder the user types; once the user types or clears the store, it is never re-derived.
  - Per-field hint copy:
    - resolved: "Found on this computer; not yet confirmed as your OpenCode folder";
    - candidate: "Usual location on this computer; not found there or not confirmed";
    - derived store: "Suggested inside the OpenCode data folder; created private if missing";
    - typed or unknown: the plain path help.
  - No hints at all: blank fields plus "Your OpenCode folders could not be detected on this computer. Enter them below." This is not an error state. The UI never guesses paths itself.
  - Malformed hint fields read as unknown, and a configured reply's hints are ignored.
- **Review before any change.** "Check these folders" sends `POST /v1/setup/inspect` with the three roots exactly as they stand in the form (after any edits). It writes nothing.
  - The review card then shows the resolved companion folder (`<config>/plugins/agent-progress`), OpenCode data folder, progress store, any installed version, diagnostics, the **privilege** disclosure (full user access; records only reported progress) and the **separate lifecycle** disclosure: capture survives closing, pausing or uninstalling the extension; use "Remove capture" before uninstalling the extension, because uninstalling it alone leaves capture installed (the companion's remove utility also works afterwards); history is always kept. The host offers no uninstall hook, so nothing is cleaned up automatically. The "Remove capture?" confirmation repeats the before-uninstall advice.
  - Install needs the acknowledgement checkbox. It sends `confirmed:true` with exactly the inspected roots.
  - If the typed folders already hold the companion, the review becomes **Review before updating** and sends `update` with exactly those roots. This is the recovery after the extension is reinstalled or updated, which removes the service's binding; it re-binds the same store and source.
  - The "Install again" route over an existing companion keeps Install disabled with "Use update instead".
- **No silent target switching.** Disable, enable, remove-capture and update send only `{confirmed:true}`, so they act on the configured folders. Each confirmation card restates those folders and the consequence. Only install/update with an explicit inspect can choose folders.
- **Bodies.** They contain only `configRoot`, `dataRoot`, `storeRoot` (all three or none) and `confirmed`.
- **Errors.** `SetupError {error: code}` renders in plain language; unknown codes show as "Setup could not finish (code)". Partial install codes are titled "Setup only partly finished".
- **Reload.** "Start a new OpenCode session or reload OpenCode…" appears while the service reports `activation: reload-required` (after install or a companion file change). While it is pending, every refresh re-reads `GET /v1/setup`, so the notice clears in the same open frame once the service observes the loaded companion. File installation is never presented as activation, and the UI never restarts anything.

## Honest states (plain language, distinct from authoritative empty)

| State | Shown as | testid |
| --- | --- | --- |
| Loading | spinner "Loading progress" | `state-loading` |
| Service not set up | rail/page setup flow; Work Status "Agent progress is not set up yet" + Set up | `setup-needed`, `setup-panel` |
| Grant missing / paused / disconnected / not responding / busy / damaged / newer format / unreadable reply | toned banner with Try again | `state-not-approved`, `state-paused`, `state-disconnected`, `state-unavailable`, `state-busy`, `state-damaged`, `state-incompatible`, `state-invalid` |
| Refresh failed after good data | last data kept + "Showing progress from HH:MM … may be out of date" | `stale-banner` |
| Service reports not set up after this frame showed data | last data kept, banner "Progress setup can’t be read right now" | `stale-banner` (kind `setup-lost`) |
| Capture turned off | quiet warning line | `capture-off` |
| Store/session/folder has no plans | kit empty state (compact in Work Status) | `empty-state` |
| No session or directory | "No session selected" / "No project open" | `unscoped-state` |
| Filters match nothing | page detail empty | `filtered-empty` |
| Detail / document / history loading or failed | inline line, Try again where useful | `detail-loading`, `document-loading`, `history-loading` |
| No live SDK coverage / other source | chip "Not open in this window", "From another OpenCode setup", page note | `coverage-note`, `other-source` |
| Plan from an unverified source | "Unverified OpenCode setup" in the header, "Unverified setup" list badge | `unverified-source` |
| Document text from an earlier capture | warning line above the text | `document-historical` |

Live session state (Running, Retrying, Waiting for permission, Waiting for an answer, Idle, State unknown, Checking…, Live state unavailable, Not open in this window) is always separate from task status. Age is information only: nothing is inferred from it.

## Controller

- **Refresh (latest context wins).**
  - A context notification re-reads only when the **list scope** changes. The host announces one switch in steps (session, then directory); a step that keeps the scope keeps the read already in flight.
  - When the scope changes, the obsolete read is retired, not awaited: the new read starts at once and the old reply is dropped by generation. Overlap is bounded to one obsolete plus one current read; anything more collapses into one queued follow-up. Same-scope requests still coalesce (one in flight, one follow-up).
  - `pagehide` stops the gate (no new or queued reads) along with timers and subscriptions.
- **Scoped reads and recent memory.**
  - Each read carries its scope key and is never shown for another session or directory.
  - Each frame remembers the last **complete, validated** list read of up to 8 recent scopes (`RECENT_SCOPES`), keyed by host account + store ID + bound source + verified flag + scope. Any store or binding change, setup action or disposal clears it.
  - Returning to a remembered scope paints it immediately, with no spinner, and revalidates quietly; the view repaints only if the reply differs. If the service is failing, the remembered data shows under the out-of-date banner with its own time.
  - An unseen scope still shows loading, never another scope's data.
  - Plan detail, document and history stay cached by plan key plus revision or capture. Live session chips always come from the current live subscription, never from memory.
  - The rail also remembers the chosen plan for up to 8 recent sessions, so a revisit paints its own selection at once (host storage stays the durable copy and is re-read).
  - **Limit:** a frame the host rebuilds (for example, the per-project rail open state swapping rail and Work Status on a project switch) starts cold.
- **Polling.** 3 s; 8 s after a failure; paused while hidden; stopped on `pagehide`.
- **Workspace subscriptions.**
  - Projects: 1 stream. Session streams are capped at rail 4, status 2 and page 16, all under 32.
  - Streams are released on change and on dispose, including late resolutions.
  - **Restarted on every session/directory notification.** The host's PluginPane clears a frame's workspace subscriptions without telling the guest when its effect re-runs (observed on session navigation), so the guest re-subscribes.
- **Repaint.** Only when data, live state, context or UI state changed.
  - A background repaint waits while a kit popup is open.
  - Focus, scroll, open disclosures and typed setup fields survive a repaint.
  - Setup typing does not repaint.
- **UI updates.** Functional `updateUi` merges onto the latest UI state, so writes after an await are safe.

## data-testid contract (stable for QA5/QA6)

- **Root and plans:**
  - `progress-root` (`data-surface`)
  - `plan-<planId>` (`data-lifecycle`, `data-source`, `data-revision`)
  - `counts`, with `data-done`, `data-total`, `data-remaining`, `data-skipped`
  - `other-source`, `unverified-source`
- **Items:**
  - `items-<planId>`
  - `item-<itemId>` and `group-<itemId>` (`data-status`)
  - `item-toggle-<id>` and `group-toggle-<id>`
  - `relay-<itemId>`
- **Work and sessions:**
  - `current-work`
  - `contributors`, `contributor-<sessionId>` (`data-role` main/child)
  - `open-session-<sessionId>`
- **Document and history:**
  - `document-<planId>` (`data-state`), `document-state`, `document-text`, `document-loading`, `document-historical`
  - `history-<planId>`, `revision-<n>`, `history-loading`
  - `detail-loading`
- **Rail:** `plan-selector`, `helping-note`, `scope-note`, `details`
- **Work Status:** `open-detail`, `more-plans`, `setup-needed`, `setup-needed-action`
- **Page:**
  - `filters`, `filter-project`, `filter-worktree`, `filter-session`
  - `plan-list`, `project-<projectKey>`, `plan-row-<planId>` (`data-source`: two sources can report the same plan ID), `list-empty`
  - `plan-detail`, `detail-tabs`, `coverage-note`, `setup-section`
- **Setup:**
  - `setup-panel` (`data-phase`), `setup-form`, `setup-configRoot`, `setup-dataRoot`, `setup-storeRoot` (each with `data-hint` = `resolved` | `candidate` | `derived` | `none`)
  - `setup-hints-loading`, `setup-hints-unknown`
  - `setup-inspect`, `setup-review`, `setup-ack`, `setup-confirm`, `setup-cancel`, `setup-disclosure`
  - `setup-status`, `setup-disable`, `setup-enable`, `setup-update`, `setup-remove`, `setup-reinstall`
  - `setup-confirm-disable`, `setup-confirm-enable`, `setup-confirm-remove-capture`
  - `setup-error` (`data-code`), `setup-notice`, `setup-reload`, `setup-recovery`, `setup-loading`
- **States:** the testids in the table above.

## QA harness (`tests/browser`)

- **`model.test.ts`** (23 tests) covers:
  - v2 list mapping and count rules; participants
  - scope, navigation gating (verified source + coverage) and live labels
  - page filters and age text
  - list paging and unconfigured health
  - detail revision-change restart and dual-cursor paging
  - document capture pinning, retained capture, and a capture replaced between pages (historical); history
  - fixed error codes; setup body, phases and plain-language codes; setup suggestions parsing, prefill precedence and provenance copy
  - refresh orchestration: same-scope coalescing, latest-switch-wins with bounded overlap, stop on dispose; recent-scope memory bounds and keying; subscription cap, restart and late release
- **`fixtures.ts`:** v2 wire fixtures (P1/P2/P3 plus an other-source plan, setup replies).
- **`seed-real.ts`:** seeds a real store through the production write path without a model.
  - Loads the **installed** companion (hash-checking loader → release payload) and calls its registered `agent_progress_report` tool.
  - Caller identity comes from real session records of the isolated host.
  - Supports `rev:"auto"` (reads through the tool first), simulated permission denial, file `write`/`rename` steps, and a per-step `clockOffsetMinutes` test clock (seeding process only) for genuinely old reports.
- **`real-tool.ts`:** the installed-companion loader shared by `seed-real.ts` and `live-adapter.ts`.
- **`live-adapter.ts`:** runs the packaged service standalone (host-shaped loopback port and bearer, explicit binding) and drives `ui/shared/source.ts` against it. It injects real companion writes between pages: a revision change mid-detail (restart) and a document re-capture mid-read (historical).
- **`race-document.ts`:** the same re-capture race in a real frame. It holds the frame's pinned continuation request at the host page (CDP `Fetch`), runs real writes, releases it, and checks the historical note.
- **`cdp.ts`:** drives the isolated desktop host over CDP: real frame clicks (`fclick`), bounded waits (`fwait`), keys, screenshots and console capture. Frames are chosen by URL part, or by `surface:<panel|status|page>` (matched on the view's own `data-surface` root). The relay runtime delivers guest documents as `srcdoc` frames with no URL, so it uses the latter, with click offsets taken from the frame's owner element.

- **`setup-intercept.ts`:** QA9 interceptor on the host's service proxy (CDP `Fetch`). It logs every guest service request (method and path only), can hold `GET /v1/setup` replies (late hints) and can strip `suggestions` (a service without hints). It is controlled live through a JSON file.
- **`perf-probe.ts` / `perf-analyze.ts`:** lifecycle and performance probe for an isolated host. It attributes every guest→host SDK message, frame mount, service call and visible render state to a frame instance while driving real session switches (`perf/*.json` scenarios). The analyzer exits 1 when a revisited scope shows loading, a switch needs more than one list round, another scope's plans appear, or idle data repaints. `perf-hostcost.ts` and `proc-cpu.sh` compare host navigation latency and CPU with the extension enabled and disabled.

The real-service run is recorded in `evidence/ui/qa.md`.

## Known gaps

- The relay runtime was verified once, owner-authorized, on OpenChamber's public cloud relay between two isolated desktops (relay-only pairing link). There is no isolated or self-hosted relay route for repeatable testing (`evidence/ui/qa.md`, T6 final round).
- The web runtime was verified through the desktop host's embedded web server in an isolated Chromium, not a separately launched web CLI.
- Running/waiting live labels still need model-driven sessions; T6 checked idle and recorded-only sessions.
