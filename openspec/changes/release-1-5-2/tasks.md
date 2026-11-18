# Tasks

Each numbered group is one pull request into the development branch. It carries its own documentation, English/Russian/Simplified Chinese copy where copy changes, and a regression test that fails before each fix. It passes portable CI alone, commits no generated output and changes no version. Groups 2, 4 and 6 touch disjoint source and test files and can be worked in parallel; group 5 is independent of every other group. Group 3 starts after group 2 has merged, because both change the end of the bulk run in the shared view controller, and after group 4, which rewrites the same line of the Tidy result statement in `docs/ui.md`. Group 1 starts after groups 2, 3, 4 and 6 have merged and merges last: it shares the controller with group 2, the cleanup model with group 4 and the bulk-count paragraphs of `docs/ui.md` and `docs/contracts.md` with group 6, and it changes how the end of a run hands its receipts to the selection, in lines groups 2 and 3 change before it. Groups 1 to 6 archive no OpenSpec change; the release pull request of group 7 does.

## 1. Counts and selection while plans change

- [ ] 1.1 Record on the list read that it crossed a page boundary, and carry that into Tidy and Select all confirmations built from the loaded list: the count line and the deletion step say that some plans may have been missed. Keep a single-page list, explicitly chosen rows and a Try again recount of named plans exact, add no read, and leave the selection bar's plus rule as it is. Test the controller with a multi-page and a single-page list, for Tidy, Select all, chosen rows and Try again.
- [ ] 1.2 Make a search freshness reply certify the result page it was asked about by that page's number in the search, and only the plans it covered. Test with a held reply across a Load more that drops the oldest retained page.
- [ ] 1.3 Retire freshness reads in flight when the search is retired after a cleanup. Test with a reply held across an archive under Select all: it marks nothing checked and does not select the archived plan again.
- [ ] 1.4 Pass the plans a freshness reply showed gone to the selection separately from the page's checked state, so they leave the selection whichever page is shown. Test with a selected plan whose hits span two retained pages.
- [ ] 1.5 Keep receipt departures apart from deselections when an action captures a Select all rule, and let a fresh count include a departed plan it finds in the view at a newer cleanup generation than its receipt returned. Hand that generation from the run to the selection with each receipt, as a map from plan to cleanup generation, for the bulk run and the single-plan action alike; do not read it from a loaded row. Test: restored elsewhere and counted again; a departed plan the page never loaded, restored elsewhere and counted again; deselected stays out; deselected and departed stays out; still archived stays out.
- [ ] 1.6 Start a result page opened by Load more unchecked, whatever the previous page's state. Test after a checked page.
- [ ] 1.7 Update the counting, Select and selection-context statements of `docs/ui.md` and the bulk-count paragraph of `docs/contracts.md`, including the consequence for lists longer than one page. Run the root and interface typechecks and the browser logic tests.

## 2. Account, store and capability

- [ ] 2.1 Capture the integration account and the store and binding identity when a bulk run starts, and when either differs at its end drop the run's own state without resetting caches, changing the selection, closing the opened plan or showing a result. Test with a held request across an account switch and with equal identifiers in the new store; keep the scope-change-only case as it is.
- [ ] 2.2 Remove withdrawn cleanup facts from every remembered list scope when a health reply stops offering them, so adopting a remembered scope never restores them. Test both sequences: a switch between Current and Archived plans, and a failed list read after a health reply without cleanup.
- [ ] 2.3 Release the busy state when the account or store changes, and bind it and the stale-answer cleanup to the request that set them, in the single-plan action as well as the bulk run, so the new board's cleanup controls work at once and a late answer can neither complete, release nor reset a newer run, also after a switch away and back. Test: Tidy opens after a switch with a request still held; a late answer during a newer run leaves that run pending; a held single-plan request, an account switch, a new Tidy run, then the old reply: the new run completes and shows its result; a held request, a switch away and back, a new run, then the old reply: the new run keeps its state and result.
- [ ] 2.4 Update the binding, failure and invalidation statements of the closed-plan cleanup section of `docs/ui.md`. Run the root and interface typechecks and the browser logic tests.

## 3. Background updates and focus

- [ ] 3.1 Repaint a count that finishes by itself, its failure and the end of a Check more continuation through the background lane; keep explicit actions on the immediate lane. Test: a count finishing during a press on an unrelated control leaves that control in place until its click.
- [ ] 3.2 Repaint run progress through the background lane. Test: a receipt arriving during a press on Stop leaves Stop in place, and the run stops after the request in flight.
- [ ] 3.3 Decide a deferred cleanup focus move when it is applied: apply it only if focus is still inside the cleanup panel or was lost with the removed control, and drop it otherwise. Test: focus moved to Search before the Tidy button reappears stays in Search; focus left on Stop moves to Tidy; a count delayed by a held control does not take focus back.
- [ ] 3.4 Update the result, focus and controller repaint statements of `docs/ui.md`. Run the cleanup rendered driver's keyboard pass at desktop width and 390 px, the root and interface typechecks and the browser logic tests.

## 4. Unconfirmed results

- [ ] 4.1 Keep the failure class of each bulk request in the run engine and report unconfirmed plans apart from skipped ones, using the classes the single-plan messages already use. A plan the run did not attempt is never unconfirmed. Test each class against the cleanup fixture and with a held or failed transport: refused as changed, store busy, lost reply, unreadable receipt, an attempt rejected before it reached the service, left out before sending, stopped before sending.
- [ ] 4.2 Reword the result line in English, Russian and Simplified Chinese as the design tables it, as whole strings with plural rules, for archive, restore and delete; keep one sentence and one announcement. Test the strings and the view for skipped only, unconfirmed only and both; review Russian and Chinese by reading.
- [ ] 4.3 Keep Undo to validated receipts and Try again to a recount of skipped and unconfirmed plans together. Test both after a run with unconfirmed plans.
- [ ] 4.4 Update the Tidy result statement of `docs/ui.md` and the bulk run paragraph of `docs/contracts.md`.
- [ ] 4.5 Raise the cleanup fixture's request limit for service calls to 30 seconds while its readiness probe keeps a short bound, check the fixture's other users still pass, and make the selection driver assert that the archive result reports every plan archived before it uses Undo. Run the selection driver and the backend cleanup suites that use the fixture, then the root and interface typechecks and the browser logic tests.

## 5. Large-library gate precision

- [ ] 5.1 Capture the request and reply offsets of a timed window in the browser evaluations that start and stop its timer, and slice between them, in a helper the unit tests can call.
- [ ] 5.2 Report a follow-up request sent after the next refresh started outside the per-refresh buckets, compare that figure with the baseline's, and keep health reads out of per-refresh traffic.
- [ ] 5.3 Record the attribution method and the wall-clock split of both inbox forms in the artifact; make the gate distinguish artifacts that bucketed replies, and compare the inbox form carried by the list read on its own as well as combined.
- [ ] 5.4 Report the combined inbox budget as unverified when the baseline or too few candidates carry the split, with its own summary state and an unsuccessful exit, while the other comparisons still run.
- [ ] 5.5 Strengthen the tests so they fail for reply-ordered attribution and for the wrong denominator: a reply landing after the final first-page reply, one start with two health replies and ten plan replies, and a mix of an older candidate, a current candidate and one without a split.
- [ ] 5.6 Update the large-library paragraph of `docs/ui.md`, including how a baseline is recorded for the current artifact format: the current driver run against an interface build from before the 1.5.1 responsiveness change, the last one that shows the stall a baseline must show. Rehearse that procedure once, and report the completed baseline run in the pull request as local synthetic-host evidence without committing a measurement. Run the gate and attribution tests, and one rendered run of the driver to show the offset capture.

## 6. Guidance, receipt evidence and documentation

- [ ] 6.1 Reword the moved-back sentence in the skill, the tool description and the inline guidance so the block is cleared against the plan's current prerequisites, read before a handoff, with a still-listed skipped prerequisite counting as unfinished. Keep the tool description within its tested limits and update the active-tool statement of `docs/contracts.md`. Judge it by reading, not phrase search: given only the companion's text, record what an agent does after a revision removes one of two prerequisites.
- [ ] 6.2 Check a delegation receipt's state against its dispatch and its declared tasks in the coordinator refusal reader before inferring a cleanup retirement, and mark the guidance incomplete when the check fails. Test reserved without a dispatch, pending with one, pending or reserved with no tasks, a cancelled declaration read as before, and the well-formed cases after a restore.
- [ ] 6.3 State in `docs/ui.md` when chosen plans are validated by point lookup, when the loaded rows or a list scan are used instead, and when a moved revision is skipped.
- [ ] 6.4 Name the retry baseline in `docs/contracts.md` and `docs/ui.md`: the revision supplied to the count, which on Try again is the original target's revision. Run the root typecheck and the affected backend tests.

## 7. Joined verification and release

- [ ] 7.1 After the groups above have merged, run one rendered journey on the development branch at desktop width and 390 px: Tidy and a mixed selection with archive, Undo and delete; a search selection across two result pages with a plan archived from another frame; the result line with skipped and unconfirmed plans in three languages; and a keyboard-only pass through count, run, Stop and result.
- [ ] 7.2 Run the measuring driver on the joined branch and the gate against a baseline recorded with the same driver. Report every row, including any reported as unverified. Commit no measurement.
- [ ] 7.3 Run portable CI in a fresh full-history disposable checkout with a cleared environment, and review every public diff for private data.
- [ ] 7.4 Prepare the release in one pull request into the development branch: version 1.5.2 in the package and the release constant, the changelog entry and curated release notes. This pull request is not documentation-only for CI: release notes and the changelog feed the release scripts, and tests read `openspec/changes/archive/`.
- [ ] 7.5 In the same pull request, reconcile the task lists of the 1.5.0 change, the 1.5.1 change and this one: tick each task whose work shipped, and leave a task that did not happen unticked with a note saying whether it is deferred, superseded or out of scope.
- [ ] 7.6 In the same pull request, archive the 1.5.0 change, then the 1.5.1 change, then this one, in that order, because each later change modifies capabilities the earlier ones introduced. Validate the specs after each archive. If an archive refuses a delta, correct the delta; do not skip the spec update or the validation.

## Deferred acceptance and out-of-scope follow-up

- [ ] Promotion to the distribution branch and its host gates, as the contributor guide describes. It follows the release pull request, and so the archive of this change. The nine generated outputs are built and committed by the promotion only.
- [ ] Repairing the rendered QA drivers that were already stale before 1.5.1. Tracked separately.
- [ ] A list read the service can vouch for as a snapshot, so a multi-page count can be exact again.
- [ ] Physical-phone and native-host acceptance of the changed surfaces. Emulated and synthetic-host evidence does not establish them.
