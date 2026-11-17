# Tasks

Each numbered group is one pull request into the development branch. It carries its own documentation, English/Russian/Simplified Chinese copy and checks, passes portable CI alone and commits no generated output. Groups 1 to 4 and 7 touch disjoint source files and can be worked in parallel. Group 5 merges after group 1, because both change the full page entry and the shared view controller. Group 6 merges after groups 1, 4 and 5: it selects the rows group 1 restructures, sends the acknowledgement group 4 accepts and reuses the run engine of group 5. Each pull request edits only its own sections of `docs/ui.md` and `docs/contracts.md`.

## 1. Full page responsiveness and list scrolling

- [ ] 1.1 Add a measuring driver for the synthetic large library described in the design: seeded through the production write path into a disposable store, served by the real service to source-built guests in an isolated Chromium. It records long tasks, frame gaps, root replacements, element counts and request counts for idle, plan selection, map drag, wheel pan, keyboard zoom and a real-mouse scrollbar drag on page and rail, and writes sanitized results with no request bodies or identities. Run it on the unchanged 1.5.0 source and record the baseline; confirm it reproduces the design's baseline within normal variance before changing behaviour.
- [ ] 1.2 Derive the board's shown plans, order, grouping, locations, filter choices and selection once per change of their inputs, with an index for session and project lookups and a path for unrestricted filters that builds no choice list. Cover the inputs that must invalidate it (list read, live sessions, projects and worktrees, binding and source trust, filters, view, search run, language) and the duplicate-identifier and worktree placement cases with tests that compare against direct evaluation.
- [ ] 1.3 Group visible and count-authoritative Needs you rows by plan once per change of the held inbox, device-hidden set, store and binding, and read each plan row's count from that grouping, applying the count rule of group 3 (no badge for zero; a plus only when that plan's own items may not be fully read). Test equality with direct evaluation, including hidden items and the first-window authority during a recheck.
- [ ] 1.4 Stop rebuilding when a background invalidation leaves every painted input equal, and keep the plan list's scroll container connected across background paints, updating its rows in place. Keep immediate replacement on store, account, binding and board-reading changes, and add no gesture-based paint deferral. Background repaints go through the background invalidation lane.
- [ ] 1.5 Rendered checks at desktop width and 390 px: the scrollbar drag across refreshes with a release inside and outside the frame and a reported change during the drag; keyboard listbox navigation, focus and fold state through refreshes; the existing board, search and large-plan drivers unchanged. Assert unchanged request cadence and no new timer.
- [ ] 1.6 Run the measuring driver after the change, three runs, and compare with every budget in the design. Report each figure beside its baseline. On a miss, stop and raise a design amendment. Update the controller, full-page and QA-harness sections of `docs/ui.md`.

## 2. Map: rail height, Focus current work, short help

- [ ] 2.1 Give the rail frame its fine-pointer height rule: the plan's content at the readable zoom, with the 320-pixel floor and the cap at 60% of the rail's visible height. Keep the board rule and the coarse-pointer cap. Re-run the opening-view checks for the reference plans, since the frame height feeds the fit-all scale.
- [ ] 2.2 Restore the Focus current work button after Fit with its existing name, action and announcement in three languages; keep the bar on one row at 390 px and the 44-pixel targets on a coarse pointer.
- [ ] 2.3 Shorten the help text to keys, arrow meanings and the touch line, keeping the filters and shown-task count. Keep the arrow explanation required by the arrow-state capability. Review Russian and Chinese by reading.
- [ ] 2.4 Update map tests and rendered drivers: frame height on short and tall rails with small and large plans, the button by pointer, keyboard and touch with its single announcement and unchanged selection, focus and filters, help without its own scrollbar at 390 px in three languages, accessibility-tree names, 200% and 400% reflow, and the phone map driver. Update the Dependency map section and hooks list of `docs/ui.md`.

## 3. Counts: a plus only where it can matter

- [ ] 3.1 Apply the rule to the Needs you line, its other-plans link and other-blocked count, and Work Status: no plus and no number for an incomplete zero, no statement that nothing needs the user until the read is complete.
- [ ] 3.2 Mark sub-agent summary counts and the records total by the reasons that can raise each, as tabled in the design; keep a count marked where a reason cannot be shown to leave it unaffected. Record the per-count reasons in `docs/ui.md`.
- [ ] 3.3 Update the inbox, sub-agent, incomplete-count and Work Status tests and their rendered drivers in three languages at desktop width and 390 px, including accessible names of counts. Correct the "0+" statements in `docs/ui.md` and the count-qualification section of `docs/contracts.md`.

## 4. Active-plan cleanup contract

- [ ] 4.1 Accept the in-progress acknowledgement on archive and delete, refuse it on restore and on closed plans, allow restore of an archived plan of any lifecycle, include the acknowledgement in the replay identity, and advertise the separate capability fact. Leave the cleanup storage format, guards, receipts and error codes unchanged.
- [ ] 4.2 Test with real authenticated requests against a disposable store: every row of the design's request table; stale revision and generation; replay and reused operation; delete with staged structure; and, through the production write path after an archive, a restore and a delete, each report operation named in the design, including reopen, a retried earlier report, delegation and handoff. Assert unchanged revision, tasks and history on refusal.
- [ ] 4.3 Test the read side for an archived and a deleted in-progress plan: ordinary lists, the session list, Needs you, resume briefs and waiting-delegation views; an earlier guest's request shapes; an older writer fenced by the guards; the previous service on a store that holds an archived in-progress plan.
- [ ] 4.4 Update the closed-plan cleanup section of `docs/contracts.md` as the design lists, and the capability list in `docs/backend.md`. Run the cleanup, Windows-relevant and portable backend suites.

## 5. Tidy on the full page

- [ ] 5.1 Add the Tidy button to the board bar and remove the bulk archive entry from the More menu on both surfaces. Show it during search and filtering and with nothing eligible; keep it absent without the cleanup capability.
- [ ] 5.2 Build the bounded target scan over the existing list and search reads with its ceiling, cancellation and retirement, feeding no ordinary cache; state the count, the over-the-ceiling case and the nothing-in-scope case.
- [ ] 5.3 Replace the per-plan confirmation list with the one-line panel, the Archive action and the two-step Delete permanently with its collapsed disclosure; keep focus, Enter and Escape rules. Offer Delete permanently only in Archived plans.
- [ ] 5.4 Extend the run engine: closed plans including failed, archive and delete, the per-confirmation ceiling, progress with Stop, skipped and unconfirmed plans, context-change stop, one reconciliation read, the result line, Undo for archive only and Try again for the remainder. Never send the in-progress acknowledgement.
- [ ] 5.5 Test against the real cleanup service fixture: scope with and without search and filters, plans beyond the loaded list, failed plans included, in-progress plans untouched, a plan reopened before its request, Stop, partial failure, receipt-bound Undo, no Undo after delete, capability absent, and unchanged lifecycle and history after archive and Undo. Rendered checks at desktop width and 390 px in three languages with keyboard-only passes and accessibility-tree assertions. Measure and report the run time for 500 plans on the fixture. Update the closed-plan cleanup and full-page sections and the hooks list of `docs/ui.md`, and the bulk composition paragraph of `docs/contracts.md`.

## 6. Multi-select and in-progress plans

- [ ] 6.1 Add Select mode to the plan rows and to plan results while searching, with selected state, keyboard toggling, the selected-count bar, Clear, and the narrow-width row view; keep the selection through refreshes and clear it when the board reading changes.
- [ ] 6.2 Add Select all as a rule over the current search and filters with deselection of loaded rows, and the plus-marked count until the scan has counted.
- [ ] 6.3 Offer Archive and Delete permanently in Current plans and Restore and Delete permanently in Archived plans through the run engine. State the in-progress count in the confirmation's line, send the acknowledgement only for those plans and only when the capability is advertised, and say how many are left out otherwise. Offer Restore and Delete permanently in More for an archived plan of any lifecycle.
- [ ] 6.4 Test against the real service: mixed selections archived, restored through Undo and deleted; a selected plan reported to before its request; capability absent; no acknowledgement on any closed plan or from Tidy; selection lifetime. Rendered checks at desktop width and 390 px in three languages, keyboard-only and accessibility-tree assertions, and a report sent through the production write path to an archived, a restored and a deleted in-progress plan. Update `docs/ui.md` and `docs/contracts.md`.

## 7. Companion guidance

- [ ] 7.1 Add the sentence to the skill beside its closed-plan statement, keep the tool description within its tested limits, and update the active-tool section of `docs/contracts.md`.
- [ ] 7.2 Judge it by reading, not phrase search: given only the companion's text, record what a coordinator does after `closed` then a refused reopen, and after `not-found`, and confirm the ordinary reopen case is unchanged.

## 8. Joined verification and release

- [ ] 8.1 After the groups above have merged, run one rendered journey on the development branch across rail, board and Work Status at desktop width and 390 px in three languages: a large library idle and during map gestures, list scrolling, Tidy archive with Undo and delete, a mixed selection, the map bar and help, and the counts, with a keyboard-only pass.
- [ ] 8.2 Run the measuring driver on the joined branch and compare with the budgets again. Compare a larger real library locally with the same method; commit none of its data, counts or logs, and delete the copy afterwards.
- [ ] 8.3 Run portable CI in a fresh full-history disposable checkout with a cleared environment, and review every public diff for private data.
- [ ] 8.4 Prepare the release: version 1.5.1 in the package and the release constant, the changelog entry and curated release notes, then the promotion to the distribution branch and its host gates as the contributor guide describes. The nine generated outputs are built and committed by the promotion only.
- [ ] 8.5 Archive the 1.5.0 change before archiving this one, because this change modifies capabilities that change introduced.

## Deferred acceptance and out-of-scope follow-up

- [ ] Physical-phone and native-host acceptance of the changed surfaces. Emulated and synthetic-host evidence does not establish them.
- [ ] Map zoom by wheel or trackpad pinch. It changes the documented wheel and browser-zoom contract and needs its own proposal.
- [ ] Narrowing which plans a recording gap qualifies, so history counts on unaffected plans lose their plus. It needs the service to record what a gap touched.
- [ ] Retaining the map's own DOM across background paints, considered only if the responsiveness gate is missed.
- [ ] A cleanup action for a visible in-progress plan in the per-plan More menu or on the rail.
