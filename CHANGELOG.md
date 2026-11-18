# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/). Package versions are independent of the frozen protocol/schema version (currently 2). GitHub Releases carry curated user-facing notes and editorial contributor credits, without a generated per-PR list.

## [Unreleased]

## [1.5.2] - 2026-11-18

Cleanup follow-ups from the 1.5.1 review and a companion system prompt section that stays identical across requests, so it no longer defeats a provider's prompt cache. The minimum host remains OpenChamber 2.7.1. Protocol and schema stay at 2.

### Changed

- The companion's system prompt section holds only the fixed activation guidance and is byte-identical on every request where it is present. The one-request hint after a dispatch or plan write, the sub-agent resume capsule and the delegation refusal note keep their text and eligibility but are delivered after the cacheable prefix: as a text part after a user message, or at the end of the last tool result of a tool message, never on the Code Mode `execute` wrapper's result or a non-text result, and otherwise on the next request with a valid carrier. A delivered note stays in the same place on later requests built from the same history, keyed per session and bounded to 128 sessions, 256 carriers and 128 KiB of note text per session; notes due together are joined in a fixed order, a capsule or refusal is delivered again when its text changed or its last carrier is gone, and one fixed line clears a refusal that no longer applies. Every path that removes the section removes the added notes. Providers that drop plugin system sections now also receive these notes. Cache hit rates were not measured; tests assert the byte-for-byte prefix (#165, #167; reported in #161).
- Companion inline and packaged guidance tells an agent to clear a task's dependency block against the plan's current prerequisites, read before a handoff and when a prerequisite finishes: a prerequisite the plan no longer lists no longer holds the task, and a skipped prerequisite that is still listed counts as unfinished. Decision, review and external blockers are left alone, and the guidance stays advisory (#162).
- Coordinator refusal guidance validates a pending or reserved delegation receipt against its dispatch and declared tasks before inferring that cleanup retired it, and reports incomplete guidance when the check fails. Cancellation receipts, bound receipts and the explicit-link recovery are read as before (#162).
- `docs/ui.md` and `docs/contracts.md` state when chosen plans are checked by `/v1/search-state` point lookup, when loaded rows or a list scan are used instead, and which revision a retry compares against (#162).
- The large-library gate bounds each timed window by request and reply offsets read in the browser evaluation that starts and stops it, counts cadence, list starts and both inbox forms by the requests sent inside it, and shows run reads per window as an informational row. It records how an artifact attributed its traffic, compares the list-carried inbox form on its own, and reports a budget it cannot compare as unverified with exit status 2 instead of passing it. QA tooling only; no shipped behaviour changes (#166).
- The `release-1-5-2` OpenSpec change records the proposal, design and tasks (#160). The 1.5.0 and 1.5.1 changes are archived with their task lists reconciled, the 1.5.1 deltas corrected to keep the scenario names and requirement lengths the specs hold, and a Purpose written for each of the ten capabilities their archives created.
- PLACEHOLDER (test-suite speed-up, pull request #170, still open): add the entry once it merges, or remove this line.

### Fixed

- Tidy and Select all result lines separate plans that were skipped (refused as changed, closed, reused or not found, store busy, left out of the view or never sent after Stop) from plans whose request got no valid answer and may have been applied, in English, Russian and Simplified Chinese with plural rules. Undo still restores only validated receipts; Try again recounts skipped and unconfirmed plans together, or sends the restore again for the remainder after a partial Undo (#163).
- A bulk run that ends after an account, store or binding change the frame observed, including a switch away and back, no longer resets caches, changes the selection, closes the opened plan or shows a result on the board then shown; a validated Delete receipt still removes the review marker of the account and store the run started in. The busy state belongs to the request that set it, so an observed switch releases it and a late answer cannot complete, release or reset a newer run. Cleanup controls follow the latest health reply the controller accepted, whichever remembered list is shown, and a failed list read applies its health facts in both directions (#164).
- A count that finishes in the background, a run's progress and the end of a run with its result line repaint as background data and wait while a control is held, so a press on Stop or a click on another control is not lost; a refresh no longer expires a result that has not been painted yet. A deferred cleanup focus move is decided when it is applied and dropped if focus has moved to another control (#168).
- PLACEHOLDER (pull request #169, still open): Tidy and Select all counts from a plan list read in more than one page say that plans may have been missed; a search freshness reply certifies only the result page it was asked about, and a cleanup in the frame retires replies in flight; a plan taken out of a Select all rule by a receipt is kept apart from a deselected plan; a result page opened by Load more starts unchecked. Replace with the merged wording.

## [1.5.1] - 2026-11-18

Full-page responsiveness with large libraries, visible Tidy and multi-select cleanup, and map and count fixes. The minimum host remains OpenChamber 2.7.1. Protocol and schema stay at 2.

### Added

- Full-page Tidy archives or permanently deletes closed plans, including failed plans, matching the current search and filters. Identity scans include unloaded matches and stop at 2,000 plans or 40 request windows per explicit scan; Check more continues a stopped scan, and confirmations cover at most 1,000 targets. Runs use sequential revision- and generation-checked requests, Stop and receipt-bound archive Undo; the old More-menu bulk entry is removed (#148, #149).
- Full-page multi-select supports individual rows and all matching plans, with Archive/Delete in Current plans and Restore/Delete in Archived plans. In-progress cleanup has a warning and requires `planCleanupActive:1`; selection changes retire confirmations, and scope changes, including changes to effective normalized location filters, clear selection (#149).
- The service advertises `planCleanupActive:1` and accepts literal `active: true` only for in-progress Archive/Delete, with the acknowledgement included in request identity. Restore preserves lifecycle and refuses that field. Archived plans refuse all reports before receipt replay; archiving retires pending delegation intents atomically. A 1.5.0 service cannot restore archived in-progress plans; restore them before rollback if they must remain reportable (#144).

### Changed

- Full-page derivation uses frame-scoped session/project indexes, cached board scope and selection, on-demand filter options and one-pass Needs you row badges, without changing refresh routes or read budgets. In a synthetic 511-plan library, median cold selection fell from 6,010 ms to 188 ms and drag/wheel-pan p99 frame gaps from 1,000 ms to 16.8 ms (#147).
- Desktop rail maps grow with content from 320 px up to 60% of rail height; coarse-pointer maps retain their 300 px cap. Focus current work returns beside Fit, and map help is shortened in English, Russian and Simplified Chinese (#146).
- Companion inline and packaged guidance tells agents not to retry or recreate plans the user archived or deleted unless explicitly asked; ordinary continuation of agent-finished plans remains supported. Guidance is advisory and does not change tool validation (#143).
- Tidy and Select all bind counts, confirmations and per-request checks to the effective board scope, including the fallback to All when a saved project or worktree filter has no loaded plans. A refresh that changes the displayed scope retires an open confirmation; a started run keeps its confirmed filters and rechecks each plan before sending. Losing cleanup support also retires confirmations; a finished result stays visible, but Undo needs that support. Browse scans place plans by recorded directory, and receipt-confirmed plans leave a selection. Counts read each later page one row early and fail rather than skip plans when offsets shift, or say plans may have been missed. In searched or truncated scopes on a service advertising `planTaskSearch`, explicitly chosen plans and Try again use `/v1/search-state` point lookups (at most 50 keys per request), while complete browse lists use loaded rows; more-match wording needs a confirmed further match (#155).
- Map arrows from a working prerequisite into a working dependent show beads, with arrows into done or skipped tasks plain and all motion bounds unchanged. Focus current work with no target announces the Fit all overview (#158, #156).
- Companion guidance tells agents to mark a working task blocked with a `dependency` blocker, or set it back to pending if none of its own work was done, when work moves back to its prerequisites; existing blockers are left alone and the task is cleared once those prerequisites are done again (#158). The reopen stop-reporting advice applies to `closed` and `not-found` only; `conflict` and `stage-incomplete` are recoverable (#154).
- The `release-1-5-1` OpenSpec change records the proposal and ordered implementation tasks (#142).

### Fixed

- Full-page browse-list scroll containers and row listboxes survive background updates, preserving native scrollbar dragging (#147).
- Zero counts no longer carry `+`; positive Needs you counts retain it only while that count may be incomplete, and unrelated history coverage no longer qualifies current sub-agent counts. Accessible names match visible counts (#145, #147). Board rows show an exact Needs you count only from a fresh read, and a truncated run traversal qualifies Running and Waiting separately from history-only gaps (#153).
- Restoring an archived in-progress plan shows its retired delegation intents as `retired`/`closed` in `/v1/plan?delegationIntent=1` and coordinator guidance. Unlinked dispatch ignores archived plans when finding its visible active plan, and the companion refuses a report to an archived plan before asking for document read permission (#154).
- The large-library gate and map QA driver check idle polling against the refresh cadence, count inbox reads in both request forms and follow the compact map help (#156).

## [1.5.0] - 2026-11-17

Simple-by-default progress surfaces, session-scoped Needs you and source-only development builds. The minimum host remains OpenChamber 2.7.1. Protocol and schema stay at 2.

### Added

- Tidy bulk-archives up to 50 finished or cancelled plans from the current surface list, with confirmation, sequential revision-checked requests and receipt-bound Undo. Failed and active plans are excluded; no delete route is used (#130).
- Needs you offers in-place details, Open session, Copy reply and device-local Hide with Undo. It defaults to the selected session's plans, offers other-plan navigation and shares counts with board rows and Work Status (#131).

### Changed

- Needs you includes decision/review details only when reported by the plan's top-level main session. Unknown or sub-agent main sessions are excluded without rewriting stored reports or hiding task blockers; reads add an optional main-session fact (#127).
- Rail and board use one More menu, in-place panels with Back, and Troubleshooting with Advanced details (#126). Plans open on a measured, readable map focused on current work when fit-all would be too small; Map | List, help, filters and cards are simplified (#133).
- One dismissible incomplete-counts indicator replaces coverage notices; affected counts retain `+`, with reasons and limits in Advanced details and the support summary (#135).
- Work Status uses a five-line layout with scoped activity counts, compact read failures and no task or sub-agent roster (#136).
- Fresh Setup groups existing resumable steps into four display steps without changing consent, routes or the journal; technical facts move into one disclosure (#125, #137).
- Plain-language English, Russian and Simplified Chinese copy covers default surfaces and accessible names; complete search results are announced once, with technical limits retained in Advanced details (#137). Possibly-low counts and waits use a trailing `+` instead of "at least", Needs you details read "Why" and "Asks you to", and a guard keeps "at least" out of default-state text (#140).
- Companion guidance leads with a plan-mirroring checklist and survives system-text-dropping providers through bounded tool descriptions and advisory notes on eligible direct tool results. Plan recognition covers OpenSpec change files and host-listed sibling worktrees; hints remain observational, not automatic reports (#128).
- Nine generated runtime outputs are no longer tracked on `dev`. Source checks build before tests and verify reproducibility; local promotion creates a two-parent commit containing accepted source plus built outputs for `main`, with strict distribution parity. `#dev` is no longer an installable Git ref (#132).
- Documentation-only PRs skip inapplicable CI and CodeQL checks (#124). Windows selection skips interface-only PRs and reserves slow released-migration and delayed-fresh journeys for promotion, `main`, weekly and manual runs; publication still requires full Windows checks (#134).
- The `release-1-5-0` OpenSpec change records the proposal, implementation and deferred acceptance (#123).

### Fixed

- Cancelled and failed plans support individual archive, restore and permanent deletion with the existing revision and confirmation checks; restoring preserves the lifecycle outcome (#122).
- Closing Setup retires its step presentation without cancelling an in-flight request; same-reading capture changes keep Setup open (#129).
- History loads the newest 250 revisions within its existing five-page budget and displays newest first, checking a contiguous tail before claiming success. The history route and cursor remain unchanged (#138).

## [1.4.1] - 2026-11-16

Short-step fresh Windows setup and clearer visibility for running sub-agents. The minimum host remains OpenChamber 2.7.1. Protocol and schema stay at 2.

### Fixed

- Fresh Windows setup uses bounded Setup-driven steps with progress and pause/resume, avoiding one long request that can exceed OpenChamber's 20-second limit on slow PowerShell. The old single-request routes refuse on Windows and remain available on Linux/macOS (#117).
- A sub-agent recorded as Running shows "not seen in OpenChamber now" only when OpenChamber's session list is complete and does not contain that session; the saved running state is unchanged (#118).

### Changed

- Reusable real-host release journeys provide test-only release verification, with no user-visible behavior change (#116).

## [1.4.0] - 2026-11-15

Windows startup and stepwise legacy migration, a source-wide Needs you inbox, and phone-ready progress surfaces. The minimum host remains OpenChamber 2.7.1. Protocol and schema stay at 2.

### Added

- A bounded, read-only Needs you inbox across active plans in the verified source, with decision/review blockers, separate Also blocked entries, explicit coverage and task navigation (#102).
- Simplified Chinese interface and progress summaries alongside English and Russian; recorded user text is not translated (#108).
- Optional final task changes in `finish`, committed atomically with the plan outcome and normal revision/replay validation (#105).

### Changed

- Phone rail/board layouts, safe-area and keyboard accommodation, coarse-pointer controls and tap/pan/pinch dependency-map navigation (#104). Rail and board mobile contributions are enabled so they appear in OpenChamber on phones (#112); owner-operated physical-phone acceptance is deferred to the live release, not claimed from emulation.
- Pending delegations survive unrelated task reports only with complete bounded evidence; relevant changes still refuse binding. Combined handoff reports support other worktrees (#103).
- Waiting delegations show “Next sub-agent will take this”; identifiable refusal reasons are exposed without granting authority or changing task status (#107).
- Handoff receipt lookups use a transactionally installed `(source, oid)` index without changing logical schema or replay semantics (#106).
- CI runs on every pull request, retaining the existing duplicate-run gate for same-repository main/dev heads (#110).
- Setup, reporting and compatibility documentation is refreshed (#100). A lifecycle regression covers capture-enable refusal during unfinished migration (#111).
- The `release-1-4-0` OpenSpec change is archived into the capability specs, with deferred acceptance and follow-up work recorded separately.

### Fixed

- Windows cold service health avoids blocking security discovery; legacy migration runs through bounded, freshly validated Setup steps with durable pause/resume, honest capture state and precise diagnostics (#101, fixes #99). Fresh configuration remains on the older synchronous path; moving it to the step engine is follow-up work.
- Concurrent identical Setup reads share one in-flight status run, deadline and spawn budget; starting-phase admission tolerates only the transient unsettled response before its single health reread, avoiding a startup 503 without weakening mutation overlap refusal (#113).

## [1.3.0] - 2026-11-14

Progress reported by the sub-agents doing the work, and a direct way to open a session's progress. The minimum host remains OpenChamber 2.7.1. Protocol and schema stay at 2.

### Added

- Verified, assigned sub-agents can report their own task statuses after their dispatch is bound to the plan. Direct reports retain the child's attribution in the rail and dependency map (#95).
  - Eligible post-binding contexts receive a bounded assigned-task brief. A first turn before binding does not gain reporting authority.
  - An optional `handoff.taskUpdate` combines the final handoff claim and explicit assigned-task changes atomically, with revision conflicts and replay checks preserved. A bare handoff remains claim-only; coordinators still own plan structure and finish.
- The **Open Agent Progress** session action opens the existing panel for the clicked session. **Show current session** explicitly resets its frame-local pinned scope, including when the target is unavailable (#95).
  - OpenChamber 2.7.1 retains the action item on close/reopen. After a reset, an identical action for the same session cannot be distinguished from a replay; select a different session's action first, then the original, or reload OpenChamber. See [the upstream issue](https://github.com/openchamber/openchamber/issues/6938).
- The `subagent-reporting-sessions` OpenSpec change is archived into the `session-progress-context` and `subagent-task-reporting` capability specs.

### Changed

- The advisory dispatch hint now tells coordinators to start a plan if none mirrors the work yet and to declare task assignments before the next dispatch. It remains advice only (#96).

### Fixed

- A refused `change` naming a group or unknown item now returns a recovery hint: `change` updates existing task IDs only; set group status or change structure with `revise` (#94).
- The expanded Sessions panel has one heading rather than a duplicate heading, without removing participant or host-context details (#95).

## [1.2.0] - 2026-11-14

Capture that comes with the extension, and progress you can hand to the agent. The minimum host is now OpenChamber 2.7.1. Protocol and schema stay at 2.

### Added

- The companion ships through OpenChamber's `contributes.opencodePlugin` and loads into the OpenCode the host manages (#89).
  - The service and the companion share one private binding in a dedicated folder under the canonical OpenCode data root derived from `XDG_DATA_HOME`. It is created only through explicit, confirmed `/v1/setup/managed-*` configuration, with no scanning, fallback roots or auto-adoption. `AGENT_PROGRESS_BINDING` no longer selects a production binding.
  - The companion stays dormant until it is configured, and retires synchronously on disable, removal or a binding change. Background sub-agent recovery is fenced as well.
  - A one-click, confirmed migration moves a validated legacy Setup install through remove-capture, keeping history. An interrupted removal remains a capture-off conflict, and a crash-retained configuration lock stays busy until it is cleared by hand.
  - Integrity is a warning only. The service records the expected companion fingerprint for each source in a private sidecar, and status reports `matching`, `different`, `not-observed` or `unknown`.
- An **Agent progress** `@` mention section, through `contributes.mentions`, `POST /mentions/search` and `POST /mentions/resolve`, plus the ready-health capability `planComposerHandoff:1` (#88).
  - Search returns at most 20 source-qualified rows, ranked by locality and lifecycle, within bounded work and input budgets.
  - Resolve returns a deterministic English summary of complete matching detail, capped at 16,000 characters with an explicit omitted-task count. Archived or deleted plans refuse.
- Background session actions **Insert handoff** and **Insert progress update** (`background.entry`, `mode: "background"`). They append the clicked session's bounded summary to the active chat through `host.compose`. The plan is the saved rail choice, otherwise the automatic featured plan, and other plans are counted. There is no message permission, polling or sending (#88).
- One shared, bounded summary builder in `shared/summary.ts` for previews, mentions and session actions (#88).
- English and Russian interface language selection: follow OpenChamber, English or Russian, kept in one shared device preference. The rail and board offer it, and Work Status follows. Recorded user text is never translated (#85).
- A `contributes.tools` entry for the exact `agent_progress_report` tool, with a neutral name, a checklist icon and `text` output. There is no subtitle, because receipts cannot distinguish effective from no-effect calls (#90).

### Changed

- `engines.openchamber` is now `>=2.7.1`. Older hosts refuse installation with their normal version message (#88).
- Setup's global install is no longer the normal path. Setup refuses to update a pre-change legacy loader and points to the migration instead (#89).
- Reporting health separates configuration, capture, loaded-companion observation and report freshness for managed delivery (#89).
- Updates rely on OpenChamber's native extension updates (#91).
  - The extension's official-version notice and its GitHub metadata check are removed, along with the extension's only network call.
  - `/v1/extension-update` remains for at least one release. It returns a fixed, network-free `unknown`/`unavailable` reply in the old shape, so older guests keep working.
- Restart guidance separates plugin add/remove/toggle under a caller-owned `OPENCODE_CONFIG`, which needs a restart, from updates to an installed extension, which may be picked up without one (#91).
- CI skips the pull-request run when the head is this repository's own `main` or `dev`, because the push run already checks that commit. Branch names are matched case-sensitively (#87).
- The 1.2.0 OpenSpec changes are archived into the capability specs: `plan-composer-handoff`, `managed-companion-delivery`, `native-extension-updates` and `report-tool-presentation`.

### Fixed

- Mention queries are bounded by their length rather than by the search token limit. A mention resolve takes the current store for each page, so a concurrent request reopening the store no longer breaks it (#88).
- A second managed scope that shares a store can configure and migrate, and capture can be switched off during a legacy conflict. Operational failures stay distinct from ownership conflicts (#89).
- The last open code-sanitization alert in a browser test driver is fixed at its cause with `javascriptLiteral` (#87).
- The native activity regression is refreshed for folded finished records and OpenChamber 2.7's extension-page menu. The post-release 1.1.1 native, versioned desktop companion-upgrade and extracted-host folder/ZIP installer checks are recorded on OpenCode 2.2.7 (#83).

## [1.1.1] - 2026-11-10

A roomier dependency map and quieter sub-agent warnings. Run storage moves to format 2; see Changed for the one-way upgrade.

Version 1.1.0 reached `main` without a tag or release, because the publisher could not read a compiled entry larger than 1 MiB from Git history. 1.1.1 is the same set of changes with that fixed, and is the first published release after 1.0.0.

### Added

- Dependency map arrows show the reported state of a dependency in the rail and on the board: travelling beads on an arrow from a prerequisite reported working, and a static warning-coloured line with a stop bar from an explicitly blocked one. Motion stops with capture off, a hidden frame, reduced motion, more than 300 arrows, more than 24 moving arrows or zoom below 50%. This replaces the map's earlier no-animation contract (#73).
- Sub-agent recording gaps are dated. The run store records when a gap was last detected; a gap under 24 hours old and not dismissed raises attention, and **Dismiss warning** quiets it for the whole store through `POST /v1/subagent-runs/dismiss-loss`, fenced by the detection sequence so a newer gap is never dismissed unseen. Reads add `capture.lossNotice` without changing protocol or schema versions (#70).
- A **Partial** cue beside the Sub-agents counts on the rail and board holds the routine coverage notes and the Load more history action in an inline disclosure. Notes about something unavailable or failing right now stay visible lines; Work Status keeps its single short line (#69).
- The dependency map's selection clears with a background click or Escape while keeping the panned view (#61), and its keys, definitions and qualifications sit in a collapsible **Map help** disclosure (#63).
- Curated, named GitHub releases: the publisher reads `release-notes/<version>.md` at the release commit, names the release `Agent Progress v<version>: <headline>` and uses only those notes, with editorial outside-contributor thanks and first-time contributor listings instead of a generated per-PR list. Portable CI requires the file when a change raises the package version; a separate non-blocking credit reminder assists the preparer and reviewer.
- Change proposals under `openspec/`, with the first capability spec, `subagent-loss-notices`. The guides in `docs/` remain the contract of record.
- A native rehearsal test of the 1.0.0 upgrade, reload and rollback on an isolated OpenCode runtime, a test that upgrades a store created by the released 1.0.0, and a recorded desktop rehearsal on an isolated OpenChamber 2.7.0 host (#72, #74).

### Changed

- **Run storage format 2, a one-way upgrade.** Companion activation migrates the store in one transaction; reads never migrate. An existing recording gap becomes undated. Older run-aware versions refuse the upgraded store, and an already-running older companion must be reloaded. `docs/setup.md` and `docs/compatibility.md` describe the boundary (#70).
- The fullscreen board uses up to 2400 px. On a wide board the Selected task inspector is a panel over the map's right edge shown only while a task is selected, selection keeps the card visible, and Fit all stops at 100% (#68).
- The segmented progress bar follows the look of the host kit's progress bar: a slimmer track, pill-shaped segments, and a success-coloured count with a done mark when every task is done and none are skipped (#67).
- The recording-gap note reads "Some run information wasn't recorded.", because the flag is also set for bounded payloads, capacity limits and dropped claims.
- Long featured-plan titles in Work Status wrap to the available width, with the picker below when needed (#62).
- The extension SDK pin is 2.7.0, and native runtime tests accept later Node 24.x and OpenCode 2.x releases (#64, #65). CI also runs on the newest Node 24, runs the SDK guest check and cancels superseded runs (#66).

### Fixed

- Release publication reads compiled entries from Git history in full. The eligibility check used Node's default 1 MiB child-output buffer, which the service entry now exceeds, so the 1.1.0 promotion was refused as unavailable history and nothing was published.
- A store whose run storage format is newer than the installed version supports is reported as incompatible ("Progress data needs an update") with setup reachable, not as a service that may still be starting. Run storage is classified read-only on admission; a companion install or update against an unsupported store is refused before anything changes, and the capture-disabling fallback checks and writes in one transaction (#75).
- The older activation-only format-1 run storage no longer fails the health check; it is admitted so its companion can be updated and migrate it (#75).
- Keyboard focus moves to the surviving cue or the Sub-agents heading when a background update removes a focused coverage control (#69).

## [1.0.0] - 2026-11-06

The first major release: a calmer, at-a-glance progress experience with an interactive dependency map.

### Added

- An interactive dependency map of the selected plan, in two places: a fourth **Map** tab in the fullscreen board's plan detail, and a **Plan view: List / Map** switch in the right rail. Both show the same full map: task cards with recorded prerequisite → dependent arrows, reported status in words and shapes, Ready and Unlocks next guidance for active plans (from recorded prerequisites only, never permission to start), Show all / Unfinished and group filters, pan, zoom, Fit all and Focus current work, keyboard navigation with one Tab stop, an inspector for each task's prerequisites, dependents, blocker and verified assignment, and a View as list action that reveals the selected task in the ordinary list. A task you reveal or select in the list opens selected in the map. New supported readings default to Map when complete detail records a task-to-task prerequisite, otherwise List/Progress. Pending detail shows a placeholder; failure shows its error and Retry. An explicit view choice wins for that reading, resetting on plan/scope/authority changes. Nothing about the map is stored, and graph data is read only while a Map view is shown. Older services default to List/Progress; explicitly opening Map shows an unavailable note and the lists keep working.
- The host can't open the fullscreen board from the rail, so the rail hosts the map itself; nothing opens, links or synchronizes between the two. The narrow Work Status sidebar has no map.

### Changed

- Work Status in the sidebar is compact. The featured plan's title is its picker. A bar and "3/8" sit with in-progress, needs-you, ready and waiting counts. Next come the first blocked and first working task, one line for age and live state, and "+N more plans", which opens the picker. Running sub-agents get one line each, with other records folded. Capture-off, stale and incomplete-data warnings stay visible, titles wrap instead of truncating, and it fits a 190 px sidebar.
- The fullscreen board is quieter. One bar holds Current plans, Archived plans, the search field and a **Filters** button. Plan and task status, source, project, worktree and session, the search help and scope, and Search open from Filters, while warnings, chips and the not-yet-searched notice stay visible. Plans are listed by project as compact rows with a status mark, done/total and a small bar. Each project's finished and cancelled plans fold into one **Finished · N** row, while failed plans stay in view. Search still finds folded plans, and Archived plans shows everything.
- The right rail and the board's Progress tab tell one calm progress story. One header has the plan title, which is the plan picker in the rail, and a ⋯ menu. Done/total sits beside the bar, and state chips act as both legend and filter. Every task appears once, grouped Now → Needs you → Up next, with Done and Skipped folded. A task's details open in its row: reason, next step and wait for a blocker, recorded prerequisites, what it unlocks, assignee, who reported it, and a Copy details preview. Copy progress update, Copy handoff, Task view options (Show all/Unfinished, participant, attention or plan order, expand/collapse, jumps), Plan document, Sessions and Details move into ⋯. Generic explanations sit behind ⓘ; stale, capture-off and incomplete-data warnings stay visible. Blocked tasks stay listed while you filter, counted apart from matches. Sessions are one compact row, and sub-agents show running ones on one line each with every other record folded. Ordinary links no longer use the orange accent.
- Task status marks are now crisp shapes drawn from the host theme's colours, one distinct shape per status, also in high-contrast (forced colours) mode, where the progress bar's segments now stay distinguishable too. The progress legend pairs each count with its mark. A working task's mark is announced as "Reported working". The map's Unlocks next highlight is neutral, so orange stays reserved for blocked tasks, primary actions and focus. Counts, layout and wording are otherwise unchanged.
- The README is rewritten for v1: a short, visual introduction to what Agent Progress does, with the technical detail kept in the guides under `docs/`.

### Fixed

- Rail Map → List handoffs now let Orca announce the selected task's native name before subsequent navigation and quiet repaints. All six isolated Orca speech-text scenarios pass; this is not human-listener acceptance or certification for other screen readers.
- Task-copy feedback belongs to the displayed text and never steals focus on completion. Task-parent summaries retain descendant progress, unreadable blocker details stay visibly qualified while collapsed, and roster explanations retire with their reading. Pressed controls retain native click delivery across background updates, including cancellation when released outside the guest frame.

## [0.7.0] - 2026-11-04

### Added

- A whole-plan graph read: `GET /v1/plan-graph` (advertised as `planGraph:1`) returns each item's id, kind, status, parent and recorded dependencies for the entire plan at one committed revision, produced inside a single transaction — never a mix across revisions — under the existing response ceiling. Older services report the read as unavailable and receive zero requests (#39).
- One shared, tested dependency derivation now owns dependency-derived facts: the existing readiness grouping with unchanged semantics, direct unlocks-next (a task's only distinct unfinished recorded prerequisite), longest-path depth and bounded upstream/downstream closures. The ready view delegates to it with identical behavior; future whole-plan consumers derive from the same module (#40).
- A deterministic large-plan dependency fixture (1,000 items, 2,000 dependency links, seeded status mix) loadable through real report operations into disposable stores, with a reusable status/structural replay sequence and recorded responsiveness baselines, for future performance and layout-stability QA (#41).
- CI safeguards for the public repository: full-history secrets scanning on every push and pull request to `main`/`dev` plus a weekly re-scan (checksum-verified Gitleaks CLI, including merge-commit resolutions), CodeQL analysis for JavaScript/TypeScript, and weekly Dependabot updates for GitHub Actions versions (#43).

### Changed

- History prerequisite wording distinguishes recorded information from the absence of prerequisites: `Recorded prerequisites: …` versus `No prerequisites recorded.`, with explicit Before/After phrasing on changes; unrecorded no longer reads as "requires none" (#37).
- Keyboard and focus behavior across the rail, page and Work Status: controls that remove themselves after acting (clear task filters, retry banners, search actions) hand focus to their owning section heading with a short one-shot notice; the setup confirmation returns focus to its opener like the cleanup confirmation; focus rings are visible on the plan listboxes, detail tabs, SDK buttons and the rail picker in both themes; a pending focus hand-off is cancelled when the store or binding changes, so background reads and stale actions never focus or announce in another store; the reading-position guarantee is documented with its physical bound (the page's maximum scroll) (#42).
- Report guidance asks agents to record task dependencies so readiness reflects real prerequisites (#36), and reminds them to include `op` in every report call and to resend the same call with `op` when a host rejects it with `op: Missing key` (some models occasionally omit the key).
- The durable contracts now define item identity and structural revisions: retained, removed and reused IDs, and `structuralRevision` as a count of structural report operations rather than a topology fingerprint (#38). The native task-capture runtime limitation is recorded (#35).

## [0.6.1] - 2026-11-02

### Fixed

- Stopping the progress service showed the permission banner ("Progress needs permission") on the first failed refresh before later polls on the same outage switched to "Progress service is not responding". A service outage now reads as not responding throughout; permission guidance is reserved for a genuinely missing grant, and reporting-health service facts classify it the same way.
- A configured progress store that could not be opened (corrupt, incompatible, busy or unreadable) failed service startup, so the host reported the extension's service as failed and the panel could only show "Progress service is not responding". The service now stays ready with an explicit not-ready health state and fixed diagnostics; store routes answer their documented fixed 503 codes, the damaged store state is reachable in the UI, store bytes are left untouched, and reads recover in place once the file is restored.

## [0.6.0] - 2026-10-31

### Added

- Durable sub-agent run records: the companion keeps a bounded record of each sub-agent dispatch (parent, child, agent type, dispatch description and times) and takes each run's outcome from host execution events — succeeded, failed with an error type, or interrupted with a reason — including background sub-agents that finish after their call returns. Prompts, outputs and transcripts are never stored (#31).
- Automatic plan association for sub-agents dispatched by a session with exactly one open plan, or by a delegation that names the plan. Association never assigns tasks or grants reporting authority (#31).
- An optional `handoff` report action that lets a sub-agent leave one short line and a claimed outcome (done, partial or blocked), shown as a claim rather than as task progress (#31).
- One-time, metadata-only history recovery for sub-agents that finished before capture, with a bounded automatic retry and a manual Retry history action (#31).
- Authenticated, side-effect-free `GET /v1/subagent-runs` and `POST /v1/subagent-runs/reconcile` service endpoints (#31).

### Changed

- The sub-agent section in the rail, Work Status and page now shows three separate layers per sub-agent — Ran (host fact), Claimed (the sub-agent's report) and Accepted (the plan's reported task status) — so a finished run is never presented as a completed task (#31).
- Only running, waiting-on-you and task-linked sub-agents are listed individually; the rest are summarised as counts with an expandable, pageable history, replacing the 128-row list and its routine incomplete-list warning (#31).
- Sub-agent times now come from recorded activity rather than the moment the view refreshed (#31).
- The sub-agent section is hidden entirely when no plan is in scope, including inside child sessions (#31).
- `delegate` now records a durable intent for the session's next sub-agent dispatch instead of a five-minute in-memory declaration; explicit `link` is unchanged (#31).
- Passive capture now covers sub-agent run state only; task progress still changes only through explicit reports (#31).

### Fixed

- Sub-agents that had finished showed as "Idle" and then "Unknown now", and genuinely running sub-agents decayed to unknown after about a minute; running sub-agents now stay Running until host evidence changes them (#31).
- The Work Status card could stay collapsed when the host dropped a height request; it now re-sends its height a bounded number of times (#31).

## [0.5.0] - 2026-10-30

### Added

- A Needs-you view that surfaces reported blockers and plan-specific items needing attention (#22).
- A bounded progress resume pointer delivered after session compaction, so plan state can be recovered without re-deriving it from history (#23).
- Native sub-agent activity display, with observed sub-agents shown and declared delegations bound to verified child sessions (#24).
- Explicit milestone reporting guidance on every guidance surface — including the report tool description, the only surface description-only (MCP) clients see — stating that tracker updates are not progress reports and naming PLAN_READY handoff, review approval, owner approval and actual work start as reporting boundaries; a delegated child's canonical plan write now also reminds its verified direct parent (#27).
- Conditional, fail-closed advisory hints when a dispatch or a tracker update is observed, coalesced into a single reminder per context (#28).

### Fixed

- Progress resume pointer delivery on OpenCode 2.2.2 hosts: compaction events are correlated independently of delivery ordering, restoring the pointer after real compactions (#25).
- Native verification truthfulness on current hosts: the builtin harness waits for assignment readiness before snapshotting and interacts only with genuinely actionable elements (#26).

### Development

- The native test host was re-pinned from OpenCode 2.1.4 (no longer obtainable from any public source) to 2.2.2, with archive provenance and mutability caveats recorded; the full validation aggregate now runs against the current host (#27).

## [0.4.0] - 2026-10-28

### Added

- Previewable progress updates and handoff summaries with explicit copy, privacy controls and freshness checks (#11).
- Since-last-reviewed plan change digests in the board History tab, with bounded revision reads and explicit review points (#12).
- Plan and task search across recorded history, with filters, reusable local views and results beyond the loaded plan list (#13).
- Comparison of two recorded document captures, with pinned selections, literal Unicode and line-ending diffs, bounded reads and deletion protections (#18).
- Optional reporting-health diagnostics in the board footer: compact status rows, expandable explanations and a previewable support summary that excludes private context (#19).

### Fixed

- Review-point identity uses integration-account terminology while retaining existing stored keys (#14).
- Active search refreshes capture state even when plan revisions do not change, keeping warnings and cached summaries current (#16).
- An expanded document-comparison disclosure no longer prevents background updates; pending comparison reads retire before navigation and after authoritative deletion (#18).

### Documentation

- Added regression coverage for unsupported change-item fields and clarified compact versus paged report reads (#10).
- Added the Agent Progress logo and themed README header (#15).
- Current installation and development guidance follows the selected manifest version and is separated from historical compatibility evidence (#17).
- Documented capture-comparison and reporting-health behavior, privacy boundaries and validation limits (#18, #19).

## [0.3.0] - 2026-10-27

### Added

- **Task readiness view with dependency explanations** (#7): active plans now have a Readiness section in the plan detail (session rail and fullscreen board Progress tab) grouping task items into Ready to start, Waiting on prerequisites (with a distinct skipped-prerequisite subgroup) and Blocked. Every recorded prerequisite is listed with its title and reported status, and selecting one reveals and focuses that task in the same plan; assignment labels come only from the recorded assignee. The section states that it is based on recorded prerequisites only; empty, partial, error and stale states stay distinct.
- **Focus controls for large plan hierarchies** (#9): the task view gains reading controls — Show all / Unfinished filtering with ancestors kept and labelled for context, a participant filter that distinguishes explicit assignment, links, direct reports and parent relay (the matching reason is shown on each row), Expand all / Collapse all, and Jump to in progress / Jump to blocked. Plan totals, Now and Readiness always cover the whole plan while the summary labels matching, context and hidden counts separately. The reading state (collapsed groups, focus, scroll) is scoped per view, never persisted, and survives new revisions. Navigation only — nothing changes status, assignment or readiness.

### Fixed

- Session chips in narrow sidebars (around 280 px) no longer squeeze the session name to a few characters: the state text can now wrap below the name, and a name that still cannot fit truncates with an ellipsis. Wide layouts are unchanged (#8).
- Paged plan-detail reads refuse a page from a different store, binding or plan instead of joining it; a malformed `dependencies` value refuses the reply instead of reading as "none recorded"; and a failed detail read keeps a stable error and is retried once per list refresh or on a new revision instead of being re-requested on every repaint (#7).
- A detail reply carrying a newer revision than the plan list no longer triggers a full re-read on every repaint (previously tens of thousands of requests in seconds, including from a hidden frame); host session names are shown only for plans of the verified bound source; tasks with subtasks now show their assignee and relay attribution in the summary; and a plan whose tasks were all removed is no longer treated as still loading (#9).

### Documentation

- Guides are self-contained for outside contributors: internal workflow references were removed, durable contracts (system boundaries, reporting participation, session-move/rebinding and capture-freshness rules) were consolidated into the tracked guides, and stale statements were corrected to match shipped behavior (#6).

## [0.2.9] - 2026-10-27

### Added

- Compact plan picker with management of finished plans (#4).
- Sidebar progress scoped to the selected session (#5).

## [0.2.8] - 2026-10-26

### Fixed

- Native Windows progress capture support, retained-source reinstallation, and clearer progress invocation and working-plan selection (#3).

## [0.2.7] - 2026-10-26

### Fixed

- External worktree project ownership: live grouping and coverage of external worktrees (#2).

## [0.2.6] - 2026-10-26

### Added

- First automated release from `main`: update awareness, live progress cues and proactive reporting (#1).

## 0.2.5 and earlier

Baseline before automated releases; see the repository history.

[Unreleased]: https://github.com/Phototonic/openchamber-progress/compare/v1.5.2...HEAD
[1.5.2]: https://github.com/Phototonic/openchamber-progress/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/Phototonic/openchamber-progress/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/Phototonic/openchamber-progress/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/Phototonic/openchamber-progress/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/Phototonic/openchamber-progress/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Phototonic/openchamber-progress/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Phototonic/openchamber-progress/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/Phototonic/openchamber-progress/compare/v1.0.0...v1.1.1
[1.0.0]: https://github.com/Phototonic/openchamber-progress/compare/v0.7.0...v1.0.0
[0.7.0]: https://github.com/Phototonic/openchamber-progress/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/Phototonic/openchamber-progress/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/Phototonic/openchamber-progress/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Phototonic/openchamber-progress/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Phototonic/openchamber-progress/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Phototonic/openchamber-progress/compare/v0.2.9...v0.3.0
[0.2.9]: https://github.com/Phototonic/openchamber-progress/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/Phototonic/openchamber-progress/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/Phototonic/openchamber-progress/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/Phototonic/openchamber-progress/commits/v0.2.6
