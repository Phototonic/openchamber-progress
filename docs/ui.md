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
| `adapter.ts` | **Only** module that knows the wire format. Validates and maps v2 replies: `/health`, `/v1/plans`, `/v1/plan` (with optional `timing`), `/v1/document`, `/v1/history`, `/v1/setup`, `/v1/extension-update`. Builds query and setup bodies. Protocol/schema ≠ 2 fails as incompatible. |
| `model.ts` | View model and pure semantics. Plan summaries use server `counts`; detail subtrees use the shared `countItems` (same rule). Hierarchy, current work, participants, document-state copy. |
| `source.ts` | Paged reads through the host proxy (rules under v2 mapping below). Classifies fixed error codes into plain states. |
| `live.ts` | SDK workspace enrichment: one projects stream plus capped session streams. Coverage, live-state labels, navigation gating (`canOpen`), and `restart()` after a context change. |
| `scope.ts` | Server list scope per surface, owned-first ordering, page project/worktree grouping, coverage gap. |
| `setup.ts` | Setup UI, phases, plain-language SetupError and diagnostic text. |
| `official.ts` | Official-main version notice (rail and page) and the compact Work Status line. |
| `app.ts` / `refresh.ts` | Frame lifecycle, caches and repaint rules (under Controller below). |
| `components.ts`, `style.ts`, `format.ts` | DOM pieces, CSS from host tokens only (including reported-progress motion), locale-aware time. |

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

Phases come from `GET /v1/setup`: `unconfigured`, `installed`, `disabled`, `reload-required` (selected files without a matching observed load), `removed`, `recovery` (staged files present). Rules:
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
- **Reload.** "OpenCode has not loaded the current companion files yet. Restart OpenCode when convenient…" appears while the service reports `activation: reload-required` (after install or a companion file change). It never promises that a new session reloads the companion, or that every open project or session is current. While it is pending, every refresh re-reads `GET /v1/setup`, so the notice clears in the same open frame once the service observes the loaded companion (the last observed load, not a check of every running session). File installation is never presented as activation, and the UI never restarts anything.
- **Companion update (upgrade UX).** A configured, verified, installed reply may carry `update` (`state: current | available | newer-installed`, `candidateVersion`, `rootVersion`; `docs/contracts.md`). The adapter drops it when malformed or on a reply that is not configured, verified and installed with a version, so absent means unknown, never "up to date".
  - Notice, shown at the top of the rail and the page (above the plan, before the reload note) and inside the Setup status card:
    - `available`, versions differ: "Companion update available · Installed 0.2.2 → bundled 0.2.3" with **Review update**;
    - `available`, same version: "Different companion build available" (never "newer");
    - `newer-installed`: warning "Installed companion is newer than this extension" with both versions, the advice that updating the extension is usually better, and a plain **Review**, never upgrade wording.
  - `current` and absent show nothing, and there is no green "up to date" or "loaded" claim. Work Status stays compact and shows no notice.
  - Review reuses the existing update flow (`inspect` with no roots, then `update` with `confirmed:true`; no new route or body field). Inspect replies carry no comparison, so the review takes the bundled version from the frame's latest setup read (inspect never replaces it). It shows the configured folders, the installed version (from inspect) and the bundled version before the acknowledgement. A comparison for another installed version is out of date, and a missing one makes no claim: the review then says it cannot say which version updating selects. This also applies while it is open, so a refused update whose re-read drops the comparison drops it from the review too. A downgrade review is titled "Review before switching to the older companion", with matching acknowledgement and button text.
  - A review started from the top notice renders in place there, and its errors and success stay with it (with Dismiss once no review is open); the Setup card then shows the plain status. Cancel closes the review and its error and brings the notice back from the same read. A refused action re-reads `GET /v1/setup` once, so the notice reflects the service again (for example, it disappears when the service no longer compares a modified installation).
  - Independent of activation. The notice clears only when a reply reports the bundled files selected (`current`); the reload note clears only on a matching observed load. Both can show at once and look different (info banner with an action vs. warning line).
  - Setup card facts: "Installed version" (the selected release), "Bundled version" ("· same files as installed" when `current`), and "Folder utility" when `rootVersion` differs. The folder utility is the loader and remove script written when the companion was installed (including Install again), which updates keep; it is not the companion agents run.
  - Detection adds no reads: frame start, setup open, readiness changes, after actions, and the existing pending-reload recheck. Progress polling never re-reads setup.

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

## Reported in-progress motion

Subtle motion marks work that agents **reported** as in progress. It never means a model is running right now, and session chips stay static.
- **Status text.** "N in progress" is blue: in the legend (rail, page) and in Work Status's compact counts line. It uses the host's readable `--oc-info-text` (`--oc-info` only as a fallback for older hosts). Task titles and paragraphs are never tinted or pulsed.
- **Gate.** Motion runs only when all of these hold (`showsLiveness`, `model.ts`): the plan is active, it has working tasks, the last read succeeded (no stale or failure banner) and capture is on. The plan element (`plan-<id>`) then carries `data-motion="on"`. Closed plans (even with tasks still marked working), stale or failed views, capture off and plans with nothing in progress stay static. Report age is not an input.
- **What moves.** All three use one 2.4 s period:
  - a light sheen sweeps across the blue working segment of the bar;
  - the working dot pulses in the Now callout and in Work Status's current-work row (glyphs in the task list stay static);
  - the status text pulses.
  Keyframes animate only `transform` and `opacity`. Bar widths and counts never animate, so the motion can't look like progress.
- **Contrast-safe text pulse.** The text keeps `--oc-info-text`. A same-glyph `::after` overlay (alt text `""`, so it isn't read twice) fades in towards a colour mixed with the foreground. Every phase therefore has at least the token's own contrast. Measured: 5.8–6.1:1 at rest in light, 6.4–6.9:1 in dark.
- **One phase across repaints.** A repaint replaces the root. `alignMotion` (`app.ts`) starts the new root's animations at the document timeline's origin, and an `animationstart` listener does the same for animations the browser restarts by itself (for example, a frame shown again). This uses no timer, no rAF loop and no per-task registry.
- **Stops.** Reduced motion removes every animation, including `::before`/`::after`. Status text and counts stay. A hidden or disposed frame sets `html[data-ap-hidden]`, which removes the animations; they resume on the shared phase when the frame is visible again.
- No completion effects.

## Elapsed time (reported in progress)

From the optional `timing` of `GET /v1/plan` (`docs/contracts.md`, T1). It shows how long a task has been **reported** in progress, never CPU, token or model time, and never proof that work continued.
- **Where.** Beside working tasks in the Now callout (rail, page) and Work Status's focus row. Nowhere else, so labels don't repeat in every row.
- **Copy.**
  - Whole minutes: "<1 min", "12 min", "3 h 5 min", "2 days 4 h"; never seconds.
  - Labels with a known start (exact or lower bound) use the readable blue `--oc-info-text`, like the status text; "time unknown" stays muted. Task titles are not tinted, and the labels don't animate.
  - Exact start: title "Reported in progress at …".
  - Lower bound: "at least 1 h 35 min", title "Observed in progress by …; start unknown".
- **Unknown.** A reply without `timing` (older service, or unreadable) shows no label at all. A working task without a usable entry shows "time unknown", never zero. This covers an unreadable entry and a start after the reply's own read time. Groups, other statuses and closed plans get no label.
- **Clock.** `readDetail` anchors each entry when the reply arrives: `readAt − since` (service clock only) plus the local monotonic time since receipt. Browser wall time is never used, so clock skew or a clock jump doesn't move it.
  - The anchor lives in the detail cache (plan key + revision), so repaints and cached revisits keep it.
  - A new revision or a remount reads a new anchor; for an unchanged interval that is the same `since`.
- **One ticker.** A single 30 s in-place label ticker per frame (`planLabels`, `app.ts`) updates ages and elapsed times.
  - It changes text only when a label differs, and never repaints, schedules a render, or uses a per-task timer or a network request.
  - It runs only while the frame is visible and shows such a label; it stops when hidden, on `pagehide`, and when no label remains.
  - On return it recomputes from the anchors at once. This replaced the old always-on 30 s age interval.
  - Reduced motion doesn't affect it: the times stay truthful text.
- **Test ID.** `elapsed-<itemId>` (`data-kind` = `exact` | `lower-bound` | `unknown`).

## Official-main notice

From `GET /v1/extension-update` (`docs/contracts.md`, U1). It says only what the official repository's **main** branch advertises. It is not the source this extension was installed from, and not a bundled or installed version.
- **Shown** when `state` is `available` and that candidate version isn't dismissed:
  - title "Official main version 0.2.5 available · This extension 0.2.4";
  - plain directions to check and update in OpenChamber Settings → Extensions for the standard official Git URL;
  - a note that custom branches, tags, forks or ZIP installs may not follow main and the extension can't tell its source.
- **Action.** **View official main** opens the fixed `OFFICIAL_MAIN_URL` (`config.ts`) through `host.openUrl`; no URL comes from a reply. There is no one-click update, no Settings navigation and no install.
- **Stale.** A failed later check keeps the known candidate, qualified with "This may be out of date: the latest check … ; last confirmed …".
- **Nothing shown** for `not-newer`, `unknown`, an older service (404) or a reply that fails strict parsing (fixed repository/branch, strict semver, consistent states). It is never shown as "up to date".
- **Dismiss** hides that candidate version only, kept in host storage (`official-main-dismissed`); a newer candidate shows again. Dismissing sends no service request. A dismissal made while a check is in flight wins over the stored value that check read (`OfficialMainState`, `official.ts`).
- **Placement.**
  - Rail and page: after the companion update notice and the reload note, and also in the not-set-up state, since the check doesn't depend on companion setup or the store.
  - Work Status: a compact "Official main 0.2.5 available" line that opens the rail.
  - The companion notice, its review and the reload note are unchanged and independent.
- **When it checks.**
  - Each visible frame asks once at host readiness, then when due: the reply's `nextCheckAt`, bounded to 5–60 min, so a skewed browser clock stays within the bounds.
  - One request per frame at a time. A hidden or disposed frame starts none and drops a retired reply.
  - Never on the 3 s poll, a session switch or a render. The service caches (1 h) and backs off upstream.
- **Test IDs.** `extension-update-notice` (`data-version`, `data-stale`), `extension-update-open`, `extension-update-dismiss`, `extension-update-line`.

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
- **Label ticker and official-main check.** See the two sections above: one 30 s text-only ticker while visible with labels; the official-main check at readiness and when due (5–60 min), never on the poll.
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
  - `plan-<planId>` (`data-lifecycle`, `data-source`, `data-revision`; `data-motion="on"` while reported-progress motion runs)
  - status text: `.ap-working-text` (legend and Work Status counts)
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
  - companion update: `update-notice` (`data-kind` = `upgrade` | `rebuild` | `downgrade`) with `update-notice-review`; `update-review-panel` (a review started from that notice); `setup-update-notice` (in the Setup card); `setup-review` (`data-action`, `data-kind`), `setup-review-versions`
- **States:** the testids in the table above.

## QA harness (`tests/browser`)

- **`model.test.ts`** (37 tests) covers:
  - v2 list mapping and count rules; participants
  - scope, navigation gating (verified source + coverage) and live labels
  - page filters and age text
  - list paging and unconfigured health
  - detail revision-change restart and dual-cursor paging
  - document capture pinning, retained capture, and a capture replaced between pages (historical); history
  - fixed error codes; setup body, phases and plain-language codes; setup suggestions parsing, prefill precedence and provenance copy
  - companion update: comparison parsing (valid, absent, malformed, contradictory), notice kinds (upgrade, rebuild, downgrade; nothing for current or unknown; independent of a pending reload), and review versions from inspect plus the snapshot (stale or missing makes no claim)
  - refresh orchestration: same-scope coalescing, latest-switch-wins with bounded overlap, stop on dispose; recent-scope memory bounds and keying; subscription cap, restart and late release
  - elapsed time: whole-minute text boundaries, optional timing parsing (absent, unreadable, bad or future entries), service-clock + monotonic anchoring regardless of browser clock, and the anchor following a revision restart
  - official main: strict reply parsing (fixed source, consistent states, older service 404 → unknown), notice rules (availability only, version-specific dismiss, stale qualifier, fixed link and copy), and a dismissal made while a check is held staying dismissed (`OfficialMainState`)
  - blue elapsed labels (muted for an unknown start)
  - reported-progress motion: the gate (closed, stale/failed, capture off, nothing working); CSS contract (motion only under `data-motion`, `transform`/`opacity`-only keyframes, reduced motion and hidden also stopping pseudo-elements, readable text token)
- **`fixtures.ts`:** v2 wire fixtures (P1/P2/P3 plus an other-source plan, setup replies).
- **`seed-real.ts`:** seeds a real store through the production write path without a model.
  - Loads the **installed** companion (hash-checking loader → release payload) and calls its registered `agent_progress_report` tool.
  - Caller identity comes from real session records of the isolated host.
  - Supports `rev:"auto"` (reads through the tool first), simulated permission denial, file `write`/`rename` steps, and a per-step `clockOffsetMinutes` test clock (seeding process only) for genuinely old reports.
- **`real-tool.ts`:** the installed-companion loader shared by `seed-real.ts` and `live-adapter.ts`.
- **`live-adapter.ts`:** runs the packaged service standalone (host-shaped loopback port and bearer, explicit binding) and drives `ui/shared/source.ts` against it. It injects real companion writes between pages: a revision change mid-detail (restart) and a document re-capture mid-read (historical).
- **`race-document.ts`:** the same re-capture race in a real frame. It holds the frame's pinned continuation request at the host page (CDP `Fetch`), runs real writes, releases it, and checks the historical note.
- **`cdp.ts`:** drives the isolated desktop host over CDP: real frame clicks (`fclick`), bounded waits (`fwait`), keys, screenshots and console capture. Frames are chosen by URL part, or by `surface:<panel|status|page>` (matched on the view's own `data-surface` root). The relay runtime delivers guest documents as `srcdoc` frames with no URL, so it uses the latter, with click offsets taken from the frame's owner element.

- **`setup-intercept.ts`:** QA9 interceptor on the host's service proxy (CDP `Fetch`). It logs every guest service request (method and path only), can hold `GET /v1/setup` replies (late hints), can strip `suggestions` (a service without hints), and can strip or replace `update` in setup reads (an older service, malformed metadata). It can also strip plan-detail `timing` or drop entries (an older service, an unknown start) and replace `/v1/extension-update` replies (404, malformed): labelled QA seams. It is controlled live through a JSON file.
- **`motion-probe.ts`:** motion QA for an isolated host. It holds reduced-motion emulation for the whole command and reports, per guest frame:
  - the gate and the running element and pseudo-element animations;
  - status-text contrast at rest, at peak and as sampled (composited over the real backdrop);
  - phase error against the document timeline, including across real repaints (`phase`);
  - renderer `Performance` deltas, repaints, in-place text updates and service requests over a window (`perf`);
  - `instrument <surface>` reloads that frame with a counter of its 30 s label-ticker timers.
- **`perf-probe.ts` / `perf-analyze.ts`:** lifecycle and performance probe (it recognises any plan ID) for an isolated host. It attributes every guest→host SDK message, frame mount, service call and visible render state to a frame instance while driving real session switches (`perf/*.json` scenarios). The analyzer exits 1 when a revisited scope shows loading, a switch needs more than one list round, another scope's plans appear, or idle data repaints. `perf-hostcost.ts` and `proc-cpu.sh` compare host navigation latency and CPU with the extension enabled and disabled.

The real-service run is recorded in `evidence/ui/qa.md`.

## Known gaps

- The relay runtime was verified once, owner-authorized, on OpenChamber's public cloud relay between two isolated desktops (relay-only pairing link). There is no isolated or self-hosted relay route for repeatable testing (`evidence/ui/qa.md`, T6 final round).
- The web runtime was verified through the desktop host's embedded web server in an isolated Chromium, not a separately launched web CLI.
- Running/waiting live labels still need model-driven sessions; T6 checked idle and recorded-only sessions.
