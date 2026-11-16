# Tasks

Each numbered group is one pull request into the development branch. It carries its own documentation, English/Russian/Simplified Chinese copy, regenerated outputs and checks, and passes portable CI alone. Groups 1 and 2 come first; later groups rebase after each merge and regenerate their outputs rather than merging bundles by hand. Group 11 touches the companion only, depends on no other group and merges before group 9.

## 1. Needs you membership: main session only

- [x] 1.1 Add the shared membership predicate and the additive main-session fact to the inbox row and plan summary types, with frozen fixtures for top-level, sub-agent and unknown main sessions, direct, handoff and relay reports, and a 1.4.x-shaped reply.
- [x] 1.2 Supply the fact from the recorded session identity in the inbox projection and the plan list/detail reads. Cover it with real authenticated requests: unchanged row grouping and counts, read-only store invariance, missing session record, and unchanged ordinary list scope.
- [x] 1.3 Keep the reporting session and details revision in the guest inbox model; derive Needs you membership and counts from held rows through the predicate; report Needs you unavailable when the fact is absent. Use the same predicate for the blocked wording on list rows and map cards.
  - Approved implementation adjustment: List and Map retain their neutral blocked labels and literal details; `itemNeedsYou` exposes the shared predicate for later presentation changes.
- [x] 1.4 Add the one-sentence rule to the companion guidance and check it with a semantic read for coordinator, assigned sub-agent and plan-owning sub-agent cases.
- [x] 1.5 Update `docs/contracts.md`, `docs/ui.md` and `docs/backend.md`; regenerate the backend entries and the three guests. Verify in a rendered browser that a sub-agent's decision blocker is absent from Needs you, present on its task and map card with its text, and counted as other blocked work, before and after an upgrade of a store that already holds one.

## 2. Surface shell and More menu

- [x] 2.1 Reorder rail and board to header, progress with text legend, Map or List, Needs you, sub-agents; place the single Map | List switch; apply the narrow-frame List default; keep the default-view rule and its reset behaviour.
- [x] 2.2 Build the single More menu with its groups, menu semantics and focus return; open Plan document, History, Sessions, Setup and Troubleshooting as panels with Back; keep the settings group in every state; move the language choice into it; add the History dot from the saved review point.
- [x] 2.3 Remove the default-UI controls listed in the hierarchy requirement and move every Details and reporting-health fact to Troubleshooting → Advanced details. Leave service reads and the existing support-summary lines untouched.
- [x] 2.4 Extend browser logic tests and rendered drivers for menu keyboard use, panel focus return, the no-plan, not-set-up and failed-read states, and language selection inside the menu, at desktop width and 390 px in three languages. Update `docs/ui.md` and affected images; regenerate the three guests.

## 3. Map as the main component

- [ ] 3.1 Before changing behaviour, render the reference plans (small, 100-task, 980-task) at standard rail widths and at 1280 px and 1920 px boards; record fit-all scale and rendered title size against the analytic table in the design. Keep 70% and 80% unless the check finds 70% illegible, in which case use the shipped 75% and record it.
- [ ] 3.2 Implement the opening view, the deterministic current-work target, the coarse-pointer opening zoom and the content-height frame.
- [ ] 3.3 Fold help, arrow key, filters and counts into one help-and-filters control with its active-filter mark and Clear line; reduce the toolbar to zoom out, zoom in and Fit with the brief zoom hint; remove pan and focus-current-work buttons without changing drag, wheel, pinch or keys.
- [ ] 3.4 Simplify cards and the selected-task summary, including the Needs you and blocked wording from the shared predicate and the region and card accessible names; move report authorship to Advanced details.
- [ ] 3.5 Update map tests and rendered drivers: opening view per branch, keyboard and touch navigation, arrow-state and motion gates unchanged, large-plan budgets, 200%/400% reflow and 390 px. Update `docs/ui.md`; regenerate the rail and board guests.

## 4. Needs you: compact, scoped, actions and hide

- [ ] 4.1 Add the device view-state store for the three states with its versioned records, bounds, pruning and failure behaviour, and unit tests for unsupported hosts, malformed records and failed writes.
- [ ] 4.2 Partition inbox rows into session, selected-plan and all-plans scopes; apply the exact-or-plus rule; add bounded automatic continuation on the existing refresh cycle with the per-traversal limit; assert no extra timer and at most one inbox request per cycle.
- [ ] 4.3 Replace the cards with the collapsed line, one-line items, in-place opening and the quiet other-blocked count; remove the pinned "opened from" reading; show the other-plans link, the empty state and the failed-read line.
- [ ] 4.4 Add Open session behind the existing open gate, Copy reply with clipboard confirmation and fallback, and Hide with Undo, the hidden count and show/unhide in the list and the More menu.
- [ ] 4.5 Show each plan's Needs you count on the board's plan rows from the same rows.
- [ ] 4.6 Extend inbox logic tests and the rendered driver against the real service: scopes, plus marks, continuation bounds, actions that change nothing, hide surviving reload and returning after a new report, keyboard and accessible names, 390 px and desktop in three languages. Update `docs/ui.md` and `docs/contracts.md`; regenerate the three guests.

## 5. Incomplete-count indicator

- [ ] 5.1 Model the set of incomplete-count reasons per surface and put plus marks on every affected count: Needs you, sub-agents, plan list and map.
- [ ] 5.2 Replace the Partial cue and all coverage notices with the single indicator: expansion, Load more, device-remembered dismissal keyed by the reason set, and the recording-gap acknowledgement with its failure and conflict handling. Keep failed-read, recording-off and other-install lines separate.
- [ ] 5.3 List reasons, limits and record totals in Advanced details and append the fixed-vocabulary lines to the support summary; assert every earlier line is unchanged and identical across languages.
- [ ] 5.4 Update sub-agent, inbox and reporting-health tests and rendered drivers, including recent, old, dismissed and legacy gaps and the returning indicator. Establish the sub-agent screenshot driver's baseline on the development branch first and repair a pre-existing fixture failure in this pull request if it blocks the check. Update `docs/ui.md` and `docs/contracts.md`; regenerate the three guests.

## 6. Tidy: bulk archive

- [x] 6.1 Add the More entry, eligibility (finished and cancelled only), the per-confirmation limit and the inline confirmation with its focus and keyboard rules.
- [x] 6.2 Run the bound per-plan archive requests in sequence with context-change stop, one invalidation, the result line, partial-failure reporting and Undo through the restore route.
- [x] 6.3 Test against the real cleanup service fixture: failed plans untouched, changed plans skipped, lifecycle and history unchanged after archive and Undo, no delete request possible, capability absent. Add rendered checks at desktop and 390 px in three languages. Update `docs/ui.md` and `docs/contracts.md`; regenerate the rail and board guests.

## 7. Work Status

- [ ] 7.1 Rebuild the card to the five-line order with the position picker, activity line, qualification rule and scoped Needs you count that excludes hidden items; remove chips, focus rows, roster rows and the more-plans line.
- [ ] 7.2 Verify height and wrapping at 190, 280 and 390 px in three languages, the host section maximum, every lifecycle and empty state, and the accessible summary. Update `docs/ui.md`, the README image and affected documentation images; regenerate the Work Status guest.

## 8. Setup presentation

- [x] 8.1 Derive the grouped presentation from the frozen plan as a pure function and test it for every plan grammar, including retained stores, reused sources and preserved recording, with pause, failure and completion inside each group.
- [x] 8.2 Rework the review to the purpose sentence, grouped steps, consent line and single disclosure, keeping consent binding, acknowledgement and stale-consent refusal; replace the running-state warning box with the plain recording line and keep the conspicuous state on pause, failure, close and completion.
- [x] 8.3 Reword migration steps and states in plain language without regrouping; keep the retained-data assurances.
- [x] 8.4 Extend the Setup logic tests and the rendered Setup driver for review, running, paused, failed and complete states in three languages at phone width with keyboard use. Update `docs/setup.md` and `docs/ui.md`; regenerate the rail and board guests.

## 9. Plain-language copy pass

- [ ] 9.1 Reword the remaining default strings and accessible names on every surface in the three catalogs together, following the copy guide: state words, sub-agent rows, session and install notes, stale and recording lines, empty states and menu labels.
- [ ] 9.2 Add a check that renders each surface's default states in each language and fails on a listed internal term in visible text or accessible names, with the allowed locations excluded. Review Russian and Chinese wording by a semantic read, not a phrase search.
- [ ] 9.3 Update `docs/ui.md`, `docs/setup.md`, the README and documentation images to the shipped wording; regenerate every affected guest and the background entry if shared copy it bundles changed.

## 10. Joined verification

- [ ] 10.1 After the groups above have merged, run one rendered journey across rail, board, Work Status and Setup on the development branch at desktop width and 390 px in three languages, covering the main-session rule, scopes, actions, hide, bulk archive with Undo, the indicator and the More panels, with keyboard-only passes.
- [ ] 10.2 Run portable CI in a fresh full-history disposable checkout with a cleared environment for each pull request and for the joined branch, and review each public diff for private data.

## 11. Plan mirroring guidance

- [x] 11.1 Before changing behaviour, establish on the native host with the scripted provider what the model receives when the post-execute hook appends text to a completed dispatch, write, edit and tracker result: whether the text arrives, whether the original output still arrives first, and whether the structured result read by run recording is unchanged in either observer order. Include a call made inside Code Mode, whose result returns to a script. Record the outcome per kind of call. Give no note to a kind that fails. If every kind fails or the native host is unavailable, stop the note carrier and raise a design amendment; tasks 11.2, 11.4 and 11.5 do not depend on it.
- [x] 11.2 Add a test provider view that keeps only tool definitions under host-prefixed names, tool results and messages, and drops plugin system text. Through the production plugin and the installed adapter, show that today's section and hints are absent from that view, as the failing baseline for 11.3.
- [x] 11.3 Add the result note as a second hint carrier for qualifying dispatch, plan-write and tracker calls: eligibility from the session's latest context, fixed text by kind, at most one per model step, original output preserved, parent relay on the parent's next observed call. Keep the context section and its hint as they are. Cover hidden tool, unverified source, recording off, unknown eligibility, failed and partial calls, duplicate calls, disposal, and an unchanged store after delivery.
- [x] 11.4 Extend plan recognition to `tasks.md` and `proposal.md` of one spec change and to plan-shaped paths inside host-listed worktrees of the writer's project, and let the parent relay cross those worktrees. Cover the archive, spec deltas and design notes, a path outside the project, an unavailable worktree list, a different project, and the existing no-file-read guard.
- [x] 11.5 Rewrite the tool description, context section, inline and packaged skill and the skill's listing line to open with the checklist, with prohibitions after it and operation detail in the skill. Keep every advertised example executable. Add the description-budget test (checklist and start example inside 2,048 characters, whole description at most 4,096) and update the native driver's wording assertion.
- [x] 11.6 Judge the result by reading, not phrase search: given only the companion's text and a neutral transcript of a planned workflow (planner hand-off, spec-change files, review, three parallel dispatches), record what a coordinator, an assigned sub-agent and a plan-owning sub-agent would do at each step, with and without a user's own reminder. Confirm no step asks for a report on mere activity.
- [x] 11.7 Update the advisory-activation and active-tool sections of `docs/contracts.md`, the activation sections of `docs/backend.md` and the provider finding in `docs/compatibility.md`; regenerate the backend entries; run the existing activation, invocation and production-contract suites unchanged except where wording intentionally moved.

## Deferred acceptance and out-of-scope follow-up

- [ ] Physical-phone and native-host acceptance of the new surfaces. Emulated and synthetic-host evidence does not establish them.
- [ ] A host capability to open a session with a drafted reply. Requested upstream; not part of this change.
- [ ] Live confirmation that an agent on a provider that drops plugin system text mirrors a plan unprompted. Delivery is verified here; model compliance is not, and needs the owner's own session.
- [ ] A request to the Claude Code provider project to forward plugin-added system sections, and a plugin-facing per-session instruction entry in the host API. Not part of this change.
- [ ] Release preparation (version, changelog, notes) and promotion to the distribution branch follow the existing release policy after this change is accepted.
