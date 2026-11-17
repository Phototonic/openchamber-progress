# Design

## 1. Existing owners and constraints

- **The full page loads a bounded library.** One refresh reads up to ten list pages of 50 plans, so at most 500 plans are held and an older remainder is reported as not loaded. The rail reads only its session's plans. Refresh runs every 3 seconds while visible; there is one timer.
- **Every paint rebuilds the whole root.** The shared controller builds a new root, restores focus, disclosures and keyed scroll positions, and replaces the old root. A background paint already waits while a clickable control is pressed or a picker is open; a scrollbar is neither.
- **Board facts are derived on demand.** The shown plans come from normalising the filters and applying them to every held plan. Normalising builds the complete filter choices twice; each plan's location needs a live-session and project lookup; a session lookup scans every session record. The result is asked for from many places in one paint (selection, reading scope, wanted projects and details, paint, panels, after-paint).
- **Each plan row counts its own Needs you items** by partitioning the whole held inbox, which also serialises a device-hidden key for every held row.
- **The inbox recheck invalidates twice per ordinary refresh** (count authority withdrawn, then restored), so an unchanged library still repaints twice per cycle.
- **The map is not the cause.** Layout is reused for an unchanged graph, gesture transforms update in place, and the rail runs the same controller smoothly.
- **Cleanup is per plan.** Archive, restore and delete each take one plan bound to its progress revision and cleanup generation, with a replayable receipt. The service refuses all three for an in-progress plan. Persistent store guards abort every write to an archived or deleted plan whatever its lifecycle; writers answer `closed` for archived and `not-found` for deleted, before receipt replay. A deleted identifier is never reusable. These guards are part of the durable cleanup format, which is validated exactly and never repaired.
- **Any lifecycle change advances the progress revision.** A request bound to a revision therefore acts on the lifecycle the person saw.
- **1.5.0 Tidy** lists the surface's finished and cancelled plans, at most 50 per confirmation, names each one, and is not offered while searching.
- **The rail map frame** is `min(content height at readable zoom + 32 px, 300 px)`; the board uses 64% of the viewport height as its cap. The controller still implements "focus current work"; only its button was removed.
- **Sub-agent counts** come from recorded runs plus current host activity. The recording-gap fact is store-wide and permanent, and the contract says a gap of any age qualifies counts.
- **Below 820 px the board has no plan rows**; the plan picker in the header replaces them.

## 2. Large-library responsiveness

**Decisions.**

1. **Derive once per input change.** The board's shown plans, their order and grouping, each plan's location, the filter choices and the selection resolve from one derived result that is reused until an input changes. Inputs are the held list read, live sessions, projects and worktrees, the binding and source trust, the filters, Current/Archived, the search run, and the language. The progress revision alone is never the key. Unrestricted filters take a path that builds no choice list. Session and project lookups use an index built with that result; the index keeps the duplicate-identifier ambiguity and the directory and worktree placement rules exactly as the linear lookups have them.
2. **Partition the inbox once.** Visible and count-authoritative Needs you rows are grouped by plan once per change of the held inbox, the device-hidden set, the store and the binding. A plan row reads its count from that grouping. Hidden items, the first-window count authority during a recheck and the plus rule in section 5 are preserved.
3. **A refresh that changes nothing rebuilds nothing.** When a background invalidation leaves every painted input equal, no root is built. A change limited to one region's state (for example the inbox busy mark) updates that region.
4. **The plan list region is kept and updated in place** across background paints (section 3). Rows of plans that did not change are not rebuilt.
5. **The map's own DOM is still replaced with the root.** Keeping it is the riskier change (focus, capture rebinding, selection, inspector, provenance and announcer contracts) and the rail shows it is not needed once the surrounding work is gone. It is the first amendment to consider if the gate is missed.
6. **Traffic is unchanged.** Ten list pages per refresh is the documented bound and stays. No route, no summary read, no new polling owner.

**Alternatives rejected.** Virtualising the list: changes keyboard, listbox and find-in-page behaviour for a cost that derivation and retention remove. Deferring paints during any pointer gesture: a held button or a drag released outside the frame can defer freshness without bound. Removing row badges or showing incomplete counts as exact: hides information to buy speed. A compact freshness route: a new service capability with its own coverage and compatibility contract, not needed for the measured causes.

**Release gate.** Measured on a synthetic library seeded through the production write path into a disposable store: 500 plans of 30 to 80 tasks with twelve progress updates each, a selected 60-task map, 600 recorded dispatch runs, two sources and six projects, served by the real service to source-built guests in an isolated Chromium at 1280 px (page) and 600 px (rail), without CPU throttling. Only the measured surface is visible. Each figure is the median of three runs. The same driver records the baseline on the 1.5.0 source and the result after the change.

| Window | 1.5.0 baseline | Budget |
|---|---|---|
| Page idle, 16 s, nothing reported: long-task total | 6,823 ms | at most 1,000 ms |
| Page idle: longest task | 842 ms | at most 250 ms |
| Page map drag, 150 pointer moves: 99th-percentile frame gap | 900 ms | at most 150 ms |
| Page map drag: long-task total | 6,317 ms | at most 1,000 ms |
| Page wheel pan, 120 events: 99th-percentile frame gap | 900 ms | at most 150 ms |
| Page keyboard zoom, 30 steps: longest task | 876 ms | at most 250 ms |
| Page, first selection of another loaded plan | 4,169 ms | at most 1,500 ms |
| Plan-list scrollbar drag: distance reached, against the same drag with refreshes paused | 29% | at least 90% |
| Page idle requests per refresh | ten list pages, one health, one inbox window, one runs page | no more than the baseline |
| Rail, every window | no long task, 16.8 ms 99th-percentile frame gap | no long task, at most 50 ms |

These are local fixture guardrails, not a product service level. Long tasks are tasks over 50 ms seen by the browser's observer; frame gaps come from animation-frame timestamps; gesture wall time includes the driver's event spacing and is not a budget. A missed budget is reported with its numbers and raised as a design amendment; it is not relaxed, retried away or dropped. A larger real library is compared locally before release; none of its data, counts or logs is committed.

**Honesty checks.** For the same fixture, the shown plans, their order and grouping and each plan's Needs you count equal the directly evaluated values. A change in live sessions, binding, filters, language, the device-hidden set or source trust appears on the next paint.

## 3. Plan list scroll continuity

The list's scroll container is the same connected element before and after a background paint, so the browser keeps the thumb, wheel momentum and touch scroll it owns. Its content is updated inside it. The mechanism is the implementer's choice, with three limits: it cannot rely on a state-preserving DOM move alone, because not every supported engine has one; it adds no gesture-based paint deferral; and a change of store, account, binding or board reading still replaces the list at once, so retired rows are never left actionable. Scroll position restoration by key stays for the cases that do replace the container.

The check uses real mouse input on the scrollbar gutter for longer than two refresh cycles, with a release inside the frame and one outside it, and a reported change arriving during the drag.

## 4. Map

**Rail height.** On a fine pointer the rail frame grows with the plan: it is as tall as the plan's content at the readable zoom, never under 320 CSS pixels and never over 60% of the rail's visible height. The floor wins on a rail so short that 60% of it is less than 320 pixels. Today's rule has no floor and a 300-pixel cap, which gives a plan with one or two rows of tasks a frame of about 110 to 210 pixels and stops large plans at 300. Coarse-pointer frames keep the 300-pixel cap on both surfaces, because a finger on the canvas pans the map and the page needs room to scroll around it. The board frame is unchanged. A taller frame does not make Fit larger for a plan that is wider than the rail: width is the limit there, and the readable view is the opening view or Focus current work. The maintainer chose this rule over a frame that is always 60% or always half of the rail.

**Focus current work.** The toolbar gets the button back, after Fit, with its existing accessible name in three languages and the controller's existing action and announcement. It frames the same target as the opening view and never selects, moves focus or changes filters. Pan buttons stay removed.

**Short help.** Help and filters keeps the filters and the shown-task count, and reduces its text to: one line of keys; at most two lines on what arrows mean (beads, bar, dashed, faint), which still say that moving beads mean work in progress as reported and not progress made; one touch line on a coarse pointer. The longer definitions (assignment and session marks, selection chain, readiness wording, panel use) leave the default text and stay in the guide; the facts they describe remain on the cards' accessible names and the selected-task summary. Opened at 390 px in each language, help shows without its own scrollbar.

Wheel zoom is not added. The contract keeps wheel and trackpad scrolling as pan and Ctrl/Cmd wheel as browser zoom; changing either affects reflow and browser-zoom users and is not a patch-level change.

## 5. Counts

A plus mark follows a number only when the number is positive and a reason that is active can raise that particular number. Zero is never written with a plus, and a zero count gets no badge. An incomplete zero shows no number; the surface does not say that nothing needs the person until the read is complete, and the incomplete-count indicator keeps carrying the caveat.

| Count | Marked when |
|---|---|
| Needs you, session or all-plans scope | the traversal has not covered every plan of that scope, or the session's plan list is incomplete |
| Needs you on a plan row or for the selected plan | that plan's own items are not fully read |
| Other blocked work | as the scope it is shown in |
| Sub-agents running, waiting for you | current activity is incomplete: the host's session list is unavailable or cut short, or some recorded children are not loaded |
| Sub-agents finished, failed, interrupted, unknown; the records total | recorded history is incomplete: not reconciled, partly loaded, or a recording gap |
| Plan position totals and Finished folds | older plans were not loaded |

A reason that cannot raise a count does not mark it. Where it cannot be shown that a reason leaves a count unaffected, the count stays marked. The recording gap is store-wide and has no end, so on a store that ever had one the history counts stay marked; narrowing that needs the service to record what a gap touched and is not part of this change. `docs/ui.md` lists, per count, the reasons that mark it.

## 6. Active-plan cleanup contract

**Requests.** The three routes and their body are unchanged, with one optional field on archive and delete: `"active": true`, the in-progress acknowledgement. Only the literal `true` is accepted; restore refuses the field.

| Request | Plan in progress | Plan closed |
|---|---|---|
| archive or delete without the field | refused, `closed` (as before) | accepted (as before) |
| archive or delete with the field | accepted | refused, `closed` |
| restore | accepted when archived | accepted when archived (as before) |

Delete still requires its literal confirmation. Every request stays bound to the store, source, plan, progress revision and cleanup generation; a stale revision or generation answers `conflict` and changes nothing. Because finishing or reopening a plan advances the revision, the acknowledgement can only be accepted for a plan that was in progress when the person confirmed. The acknowledgement is part of the request identity used for replay: the latest identical request replays its receipt, and reuse of that operation identifier with a different acknowledgement answers `operation-reused`. Receipts keep their shape. Archive and restore change no lifecycle, task, count, revision or history; a restored in-progress plan is in progress again. Error codes and statuses are unchanged; no new code is introduced.

**Capability.** A ready service adds `planCleanupActive: 1` to health. `planCleanup: 1` keeps its meaning. A guest sends the acknowledgement only when the fact is advertised.

**Later reports.** Nothing changes in the writers; the contract now states their behaviour for in-progress plans:

- *Archived.* Every report operation on the plan (start, change, revise including reopen, stage, commit, link, bind, finish, delegation and handoff) answers `closed` before receipt replay and stores nothing. An earlier acknowledged operation retried after the archive also answers `closed`. Reads still work. The service never restores a plan by itself; after the person restores it, reports are accepted again at the unchanged revision.
- *Deleted.* Every operation answers `not-found`, including a start with the same identifier. New work needs a new plan identifier. Deletion removes the same stored content as for a closed plan, including staged uploads, keeps the tombstone and is not secure erasure.
- *Current work.* An archived or deleted in-progress plan leaves ordinary lists, featured-plan choices, Needs you, resume briefs and waiting-delegation views under the existing rules for archived and deleted plans. A delegation declared before the action binds nothing afterwards and is reported with the existing refusal. Recorded sub-agent runs belong to their sessions and are not removed.

**Why not restore on report.** Letting a report un-archive its plan would need the persistent guards to change, which is a cleanup storage format change with its own migration and older-writer story. It would also undo a deliberate action without the person. A distinct `archived` error code was rejected for this release: the delegation refusal vocabulary, guest mappings and older readers all key on `closed`.

**Mixed versions.** A 1.5.0 guest never sends the field and sees unchanged behaviour. A newer guest on an older service sees no capability fact, leaves in-progress plans out and says so. Older writers stay fenced by the guards, which do not look at lifecycle. An older guest shows an archived in-progress plan in Archived plans without a Restore action.

**Rollback.** The store format does not change. A 1.5.0 service refuses to restore an archived in-progress plan (`closed`); such plans stay readable and archived until the newer service runs again. Restore them before rolling back if they must stay reportable.

**Documentation.** The closed-plan cleanup section of `docs/contracts.md` is updated in the same pull request: eligibility by action, the acknowledgement field and its refusals, the capability fact, the unchanged receipt and error table with the widened meaning of `closed`, the later-report rules above, and the bulk composition rules of section 8. The capability list in `docs/backend.md` gains the fact.

## 7. Tidy and multi-select on the full page

**Tidy.** One button labelled Tidy in the board bar, beside search and Filters. It is shown whenever the full page shows a library and the service supports cleanup, also while a search or filter is set and when nothing is eligible. It covers closed plans only: finished, cancelled and failed. Its scope is the closed plans matching the current search and filters, or every closed plan of the current view (Current or Archived) when none are set, including plans that are not loaded. Activating it opens an inline panel under the bar with one line stating how many closed plans are in scope and the actions **Archive N plans**, **Delete permanently…** and **Cancel**. In Archived plans only Delete permanently is offered. With nothing in scope the panel says so and offers nothing else. Tidy never sends the in-progress acknowledgement.

**The rail has no bulk entry**, and the More menu's bulk archive entry is removed on both surfaces. Per-plan Archive, Restore and Delete permanently stay in More for the plan shown.

**Multi-select.** A Select control in the same bar puts the plan rows, and the plan results while searching, into selection: each row is toggled by pointer or Space and exposes its selected state; no control is nested in another. **Select all** selects every plan matching the current search and filters, or every plan of the current view when none are set, as a rule, so it includes plans that are not loaded. With at least one plan selected, a bar shows the count with **Archive** and **Delete permanently…** (in Archived plans: **Restore** and **Delete permanently…**) and **Clear**. Below 820 px, where browsing has no rows, Select shows the rows in place of the plan until Done. The selection is frame-local, belongs to one board reading (account, store and binding, Current/Archived, filters, search run) and is cleared when that changes; it is never stored. A selected plan that leaves the reading leaves the selection.

**In-progress plans** are acted on only from a selection. The confirmation's one line states how many are in progress and what follows: archived ones stop accepting updates until restored; deleted ones cannot be brought back. Each request for such a plan carries the acknowledgement. Without the capability fact they are left out and the line says how many. In Archived plans, More offers Restore and Delete permanently for an archived plan of any status; a visible in-progress plan has no per-plan cleanup action.

## 8. Bulk runs

One run engine serves Tidy and selection.

- **Targets.** When the action's scope is entirely inside a complete loaded list, targets come from it with no read. Otherwise opening the panel starts a bounded scan through the existing list read (with the board's server-side filter, then the same client-side location filter) or the existing search read, collecting each matching plan's identity, progress revision, cleanup generation and lifecycle. The scan visits at most 2,000 plans, sends no cleanup request, can be cancelled, is retired by a change of context and never feeds the ordinary list or its caches. It is not a refresh: it runs once per opened panel and changes no refresh budget.
- **Count.** The panel states the exact number found, or that it covers the first 1,000 of more when the scan or the target ceiling ended it.
- **Ceiling.** At most 1,000 plans per confirmation. The remainder needs the action again. Both numbers may be lowered if rendered checks show a run or scan that is not responsive; raising them needs a design amendment.
- **Confirmation.** Inline, one short line with the count and the action. Cancel has initial focus, Enter never confirms by default, Escape cancels and returns focus to the control that opened the panel. Archive is confirmed by its button in the panel. Delete permanently opens a second step whose line says it cannot be undone and whose button names the count; what deletion removes and keeps (stored tasks, history and document copy; the original file; the replay guard; the limits of erasure) sits in one collapsed disclosure there, so the non-erasure disclosure required by the cleanup contract stays reachable without a wall of text. No plan titles are listed.
- **Requests.** One existing per-plan request at a time, each bound to the revision and generation captured for that target. A refused, changed or unconfirmed plan is skipped and counted, never retried by itself. A change of store, account, binding or board reading stops the run. Stop ends it after the request in flight.
- **Progress.** One line shows how many of the total are done, with Stop. It is announced when the run starts and ends, not per plan.
- **Result.** One line states how many of the total succeeded and how many were skipped, stays until the next action or refresh, and is announced once. After Archive it offers Undo, which restores exactly the plans this run archived, each bound to the generation its receipt returned, and reports any it could not restore. Delete offers no Undo. When plans remain, Try again opens a fresh panel for them. One reconciliation read follows the run, including after uncertain failures.

**Alternatives rejected.** A bulk route taking many plans in one request: it needs per-item partial results, a batch receipt and its own replay rules, and the cleanup contract deliberately accepts no arrays or wildcards. Acting only on loaded plans: Tidy would silently skip the older half of a large library. Listing every plan in the confirmation: unusable past a few dozen and contrary to the one-line rule; the count, the scope line and Undo carry the safety instead, and deletion keeps its own second step.

## 9. Companion guidance

One sentence is added to the skill, next to the existing statement about closed plans: when a write to a plan the agent was reporting answers `closed` although the plan was in progress or a reopen is refused, or answers `not-found` for a plan it started, the person archived or deleted the plan; the agent stops reporting to it, does not retry, and does not recreate it under another identifier unless the person specifically asks for it. The maintainer chose this over telling the agent to start a new plan for the remaining work, which would bring back a plan the person had just removed. The tool description's size limits are unchanged and still tested. Guidance stays advisory: it cannot prevent an agent from starting a new plan.

## 10. Copy

One sentence per notice, verb-first buttons, whole strings with plural rules, the plus directly after its number, and none of the internal words listed in the copy rules. English reference strings; Russian and Simplified Chinese ship in the same pull request and are checked by reading.

| Where | Text |
|---|---|
| Button | Tidy · Select · Select all · Done |
| Tidy panel | 128 closed plans match. / 128 closed plans. / No closed plans here. |
| Actions | Archive 128 plans · Delete permanently… · Cancel |
| Delete step | Delete 128 closed plans permanently? This can't be undone. · Delete 128 plans |
| Selection bar | 14 selected · Archive · Delete permanently… · Clear |
| Selection, archive | Archive 14 plans? 3 are still in progress and stop updating until you restore them. |
| Selection, delete | Delete 14 plans permanently? 3 are still in progress. This can't be undone. |
| Scan | Counting plans… |
| Over the ceiling | More than 1,000 match. This covers the first 1,000. |
| Progress | Archiving… 40 of 128 · Stop |
| Result | 128 plans archived. · Undo / 126 of 128 plans archived. 2 changed and were skipped. · Try again / 128 plans deleted. / Stopped. 40 of 128 plans archived. |
| Map | Focus current work |

## 11. Delivery, verification and rollback

Each numbered task group is one pull request into the development branch with its documentation and three-language copy, and passes portable CI alone. The responsiveness change lands before the Tidy and multi-select changes, because all three edit the full page entry and the shared controller and it is the larger restructuring. The service contract, the map changes and the count rule touch disjoint files and can land in any order. No generated output is committed on the development branch.

Interface checks use source-built disposable guests and real browser input with screenshots at 390 px and a desktop width in three languages where copy changes, with keyboard and accessibility-tree assertions. Service checks use real authenticated requests against a disposable store, including a report sent through the production write path after an archive, a restore and a delete. They are synthetic-host evidence, not native-host or physical-phone acceptance.

Rollback is by reverting pull requests in reverse order. No store format, schema or journal changes. The one stored effect is an archived in-progress plan, covered in section 6.

This change's requirement deltas modify capabilities introduced by the 1.5.0 change, so that change is archived first and this one is archived on top of it.

## 12. Open questions

Two points follow the maintainer's direction as far as it goes and take the smallest reversible reading where it stops. Each names what changes if the answer differs.

1. **Tidy's scope while a search or filter is set** is the matching closed plans (section 7). The alternative, always every closed plan, would make the button act on plans the page is not showing.
2. **The rail keeps no bulk entry** (section 7). Keeping one would mean a second confirmation and result surface on the rail.

The agent guidance after an archive or deletion (section 9) and the rail map's height rule (section 4) were decided by the maintainer and are not open.
