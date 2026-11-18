# Design

## 1. Existing owners and constraints

- **The ordinary list read pages by offset.** A refresh reads up to ten pages of 50 plans. The read is complete when the last page had no continuation. Offsets are not a snapshot: a plan that leaves the list behind the cursor between two pages moves the next unseen plan behind the cursor, and the list envelope carries no change token.
- **A complete list supplies bulk targets without a read.** Tidy and Select all count from the loaded rows when the list is complete. Otherwise a bounded scan reads the scope; each later page of that scan re-reads the previous page's last plan, the count fails when that plan is not there, and a count that crossed any page boundary already says that plans may have been missed.
- **Search keeps two result pages.** Each poll, a freshness read checks the plans of the page shown and the opened plan by point lookup. A plan that is gone leaves every retained page. A page counts as checked once a reply covered it; the board treats only a checked page as evidence of which plans are in view.
- **A Select all rule holds two kinds of absence.** Plans the person deselected, and plans a cleanup receipt took out of view. Both are merged when an action captures the rule.
- **A single-plan cleanup is bound to its account and store.** If either changed when its reply arrives, it clears its own state and touches nothing else. The bulk run stops sending on such a change, but its completion still resets caches and applies its receipts to the board shown then.
- **Each remembered list scope keeps the health reply it arrived with.** Showing a remembered scope while its new read is pending adopts that health reply, including its cleanup facts.
- **Two paint lanes.** An explicit action repaints at once, replacing even a held control. Background data waits while a control is held or a picker is open. A cleanup focus request is queued and applied at the next paint that contains its target.
- **The bulk run engine keeps receipts only.** The per-plan request already classifies its failure; the run drops that and reports every plan without a receipt as skipped. The single-plan path already says "could not be confirmed" for an uncertain failure.
- **The large-library gate** compares idle traffic per complete refresh, using requests in the order they were sent, and falls back to wall-clock counts for older artifacts.
- **A structural plan revision keeps an explicit blocked status.** Removing a prerequisite does not unblock the task that waited on it.

## 2. Counts and selection while plans change

**Decisions.**

1. **A count taken from a list read in more than one page is qualified.** The list read records that it crossed a page boundary. A Tidy or Select all confirmation built from such a list carries the existing line that some plans may have been missed, on the first step and on the deletion step. A list read in a single page is one answer from the service and stays exact. Explicitly chosen rows stay exact: they name their plans and are not a census. A Try again recount stays exact for the same reason: it names the remaining plans. The qualification is on the confirmation line only. The selection bar keeps the 1.5.1 plus rule, a plus only while matching plans are not loaded. No read is added and the ordinary list read is unchanged.
2. **A freshness reply certifies only the page it was asked about.** The page's identity is its number in the run, not its position among the retained pages. When Load more drops the oldest retained page, a reply still in flight belongs to a page that no longer holds that position and certifies nothing. Only plans the reply covered count as checked.
3. **A cleanup retires freshness checks in flight.** Retiring the search after a cleanup also retires any freshness read already sent, so a reply from before the cleanup cannot mark a page checked or undo what a receipt established.
4. **Removal is a fact about a plan, not about a page.** When a freshness reply shows a plan missing, deleted or on the other side of the archive boundary, its hits leave every retained page, as today, and the selection forgets it, whether or not the page shown was the one the reply certified.
5. **Deselection and departure are separate.** A deselection lasts until the person changes it or the selection ends. A departure ends when an Undo receipt returns the plan, when a verified read lists it, when the person clicks its row, or when a fresh count finds the plan in the view at a newer cleanup generation than the one that took it out. A plan archived here and restored elsewhere is therefore counted by the next action. The generation that took a plan out is the one its receipt returned. The run hands it to the selection together with the receipt, as a map from plan to cleanup generation where it handed over a set of plans before. It is not read from a loaded row, because Select all can archive a plan the page never loaded. A cached, unchecked page is still no evidence.
6. **A newly opened result page starts unchecked**, whatever the state of the page shown before it, and becomes checked when a freshness reply covers its own plans. Visible consequence: the note that results are being checked can show on a new page until the next poll, at most one refresh interval.

**Consequence of decision 1.** Where the scope's list spans more than one page (more than 50 plans), the Tidy and Select all count line always says that some plans may have been missed. The line is honest and the wording exists in three languages; it is also more visible than before. The maintainer accepted it as the usual line above one list page. Removing it needs a list read the service can vouch for as a snapshot, which is out of scope.

**Alternatives rejected.** Re-reading the previous page's last plan in the ordinary list read: ten pages would then load 491 plans instead of 500, changing the documented bound and the reference library's measurements. Running the bounded scan for every multi-page list: it adds up to eleven reads to each opening and still ends with the same qualified line. Treating two identical consecutive list reads as verification: strong evidence, not proof, and a new rule for a patch release.

## 3. Account, store and capability

**Decisions.**

1. **A bulk run completes only into the account and store it ran in.** The run captures the integration account and the store and binding identity when it starts. If either differs when it finishes, the run drops its own state and changes nothing on the board shown: no cache reset, no selection change, no closed plan, no result line. Device-side effects of receipts that were validated before the change stay, as for the single-plan path. A change of board scope inside the same account and store behaves as in 1.5.1.
2. **Cleanup support is what the service last said.** When a health reply shows that the service no longer offers cleanup, or in-progress cleanup, every remembered scope loses that fact too. Adopting a remembered list never raises cleanup support above the latest health reply. Support returns only with a newer health reply that offers it.
3. **An account or store switch releases the busy state.** Cleanup controls on the new board are usable without waiting for a request sent before the switch, and that request's late completion can neither complete nor release a newer run. The busy state and the stale-answer cleanup are bound to the request that set them, in the single-plan path as well as in the bulk run: both share one busy state today, and a late single-plan answer clears it and resets the cleanup panel whatever is running by then. Comparing the account and store alone is not enough, because it reads a switch away and back as no change.

**Mixed versions and rollback.** Interface only. Nothing is stored, and no request changes.

## 4. Background updates and focus

**Decisions.**

1. **A count that finishes by itself is background data.** The end of a scan, its failure and the end of a Check more continuation repaint through the background lane, so they wait for a held control or an open picker like any refresh. Opening the panel, Cancel, the confirm buttons and pressing Check more are explicit actions and still repaint at once.
2. **Run progress is background data too.** A press on Stop, or on any other control, is not lost to a progress repaint. The progress line can lag while a control is held or a picker is open; the run itself does not wait.
3. **A deferred focus move is decided when it is applied.** The move to the Tidy button after a run that ended with focus on Stop, and the move to Cancel after a count, are applied only if focus is still inside the cleanup panel or was lost with the removed control. If the person has focused another control in the frame meanwhile, the request is dropped, not kept for a later paint. A request denied because another frame has focus stays dropped, as in 1.5.1.

No timer is added and no freshness is deferred beyond the existing press and picker rules.

## 5. Unconfirmed results

Each target of a run ends in exactly one of three states.

| State | When | Result line |
|---|---|---|
| Done | its receipt was validated | archived, restored or deleted |
| Skipped | the service answered and refused it (changed, closed, reused operation, not found, store busy); or the view left it out right before sending; or the run stopped before sending it | skipped |
| Unconfirmed | the request was attempted and no valid answer came back: a lost or timed-out reply, a connection or host failure, or an answer that is not a valid receipt or one of the refusals above | could not be confirmed and may have been archived, restored or deleted |

The split follows the classification the single-plan messages already use, so one failure never reads as "changed" on one surface and "possibly applied" on the other. A failure that fits neither refusal class counts as unconfirmed: over-warning is safe, under-warning is the defect. A target the run did not attempt, because the view left it out or the run stopped first, is never unconfirmed. An attempt that fails before the service could receive it, while the request is prepared or handed over, counts as unconfirmed too: the run engine cannot tell it from a lost reply, it does not happen in normal operation, and telling the two apart would need a second failure channel for a case that only over-warns.

**Result line.** Still one sentence, announced once. English reference strings:

| Case | Text |
|---|---|
| All done | 128 plans archived. |
| Some skipped | 126 of 128 plans archived; 2 skipped. |
| Some unconfirmed | 126 of 128 plans archived; 2 could not be confirmed and may have been archived. |
| Both | 125 of 128 plans archived; 1 skipped; 2 could not be confirmed and may have been archived. |

Delete and restore use "may have been deleted" and "may have been restored". Russian and Simplified Chinese ship in the same pull request, as whole strings with plural rules, and are checked by reading.

**Undo and Try again.** Undo restores exactly the plans with a validated archive receipt, each bound to the generation its receipt returned. An unconfirmed plan has no receipt and no generation, so it is never part of Undo; if its archive was applied, the reconciliation read shows it gone from Current plans and it can be restored from Archived plans. Try again recounts skipped and unconfirmed plans together under the existing retry rules, which leaves out the ones that have left the view. Nothing is retried automatically, and the one reconciliation read after the run is unchanged.

**QA driver.** The selection driver proxies the frame's requests through the cleanup fixture's request helper, whose three-second limit turned a slow reply into exactly this unconfirmed case and let the driver continue to Undo with fewer plans than it believed. The helper's limit for service calls becomes 30 seconds, its readiness probe keeps a short bound so a hung start still fails fast, and the driver asserts that the archive result reports every plan archived before it uses Undo.

## 6. Large-library gate

QA only. Nothing shipped changes.

1. **Exact window.** The request and reply offsets that bound a timed window are captured in the same browser evaluations that start and stop its timer. A request logged after the stop is not counted, and it does not close a refresh that was still open.
2. **Delayed follow-ups are reported apart.** A request that a refresh causes after the next refresh has started, such as the automatic follow-up of a run read, is reported outside the per-refresh buckets, and the gate compares that figure with the baseline's so late traffic cannot hide there. It is never charged to the newer refresh or lost in the final open bucket. Tying it back to the refresh that caused it was the alternative; it needs the driver to know which request caused which, which the request log does not record.
3. **The artifact says how it attributed.** An artifact records its attribution method. The gate does not treat an older artifact that bucketed replies as equivalent to one that buckets requests.
4. **The wall-clock inbox split is saved** beside the complete-refresh counts, so a window with a single list start still has a split to compare.
5. **The bundled inbox form is compared on its own** as well as in the combined figure, so an extra standalone reply at a window edge cannot pay for an added first window on the list read.
6. **Health is outside per-refresh traffic.** The health read precedes its refresh's first list page, so it cannot be tied to a bucket; the cadence check already covers it.
7. **No comparable baseline means unverified.** When the baseline or too few candidates carry the inbox split, the combined inbox budget is reported as unverified. The gate then reports neither a pass nor a failed budget and exits non-zero with that state named. The other comparisons still run. A baseline recorded with the current driver removes the state.
8. **The tests tell the paths apart.** The attribution fixtures fail if requests were bucketed in reply order, and the gate fixtures use counts that differ per denominator and mix an older candidate, a current candidate and one without a split.

The driver is not part of portable CI. Decisions 1 to 6 put their logic in the attribution helper and the gate, which the unit tests cover; the browser-side capture of offsets is shown by one rendered run.

## 7. Guidance, receipt evidence and documentation

1. **A dependency block follows the plan's current prerequisites.** The moved-back sentence in the skill, the tool description and the inline guidance says to read the current plan before a handoff: once every prerequisite the task still has is done, the task blocked this way goes back to working or pending. A prerequisite the plan no longer lists no longer holds it. A skipped prerequisite that is still listed counts as unfinished. The rule stays limited to the task the agent blocked this way; a decision, review, external or other blocker is never touched. The store is unchanged: a structural revision still keeps an explicit blocked status, which is why the guidance has to say this. The tool description stays within its tested limits.
2. **Refusal guidance checks a receipt before reading meaning into it.** Before the coordinator refusal reader infers that cleanup retired a waiting delegation, it checks that the receipt's state agrees with its dispatch and its declared tasks, as the per-plan reader does: a pending declaration names no dispatch, a reserved one does, and both name at least one task. A cancelled declaration names none by design and is read as before. A receipt that fails the check makes the guidance incomplete, the existing explicit limitation, instead of producing a `closed` refusal. No receipt or store change.
3. **Point lookups are documented where they apply.** `docs/ui.md` says that chosen rows are validated by point lookup in a searched or truncated scope on a service that advertises task search, that a complete browse list uses the loaded rows, that an older service counts a truncated browse scope by list scan, and that a plan whose revision moved is skipped, not adopted, where search or session criteria apply.
4. **The retry baseline is named.** `docs/contracts.md` and `docs/ui.md` say that a named plan is compared with the revision supplied to the count, which on Try again is the original target's revision, instead of "since the count began".

Items 3 and 4 change documentation only.

## 8. Delivery, verification and rollback

Each numbered task group is one pull request into the development branch with its documentation, its three-language copy where copy changes and its tests, and passes portable CI alone. Every defect gets a regression test that fails before its fix. No generated output and no version change is committed in these pull requests.

Groups 2, 4 and 6 touch disjoint source and test files, and different lines of the guides, and can start together. Group 5 touches only the large-library driver, gate and their tests and is independent of every other group. Group 3 follows group 2, because both change the end of the bulk run in the shared controller and extend the same controller test file; it also follows group 4, which rewrites the same line of the Tidy result statement in `docs/ui.md`. Group 1 follows groups 2, 3, 4 and 6 and merges last: it shares the controller with group 2, the cleanup model with group 4 and the bulk-count paragraphs of the two guides with group 6, and it changes how the end of a run hands its receipts to the selection, in the lines groups 2 and 3 change before it, and extends the same controller test harness as group 3.

Interface checks use the controller, search and selection unit harnesses, and source-built disposable guests with real browser input for the result line in three languages and the keyboard pass. Service-facing checks use the disposable cleanup fixture. They are synthetic-host evidence, not native-host or physical-phone acceptance.

Rollback is by reverting pull requests in reverse order. Nothing is stored and no contract with the service or with older guests changes.

**Archiving.** This change's requirement deltas modify capabilities introduced by the 1.5.0 and 1.5.1 changes, and neither is archived yet. The 1.5.2 release pull request archives the 1.5.0 change, then the 1.5.1 change, then this one, in that order; each archive builds the base spec the next one's deltas apply to. The pull requests of groups 1 to 6 archive nothing. Before each archive, that change's task list is reconciled: a task whose work shipped is ticked, and a task that did not happen stays unticked with a note saying whether it is deferred, superseded or out of scope. An archive that refuses a delta is a finding to resolve in the delta, not a reason to skip the spec update or the validation. Promotion to the distribution branch follows the release pull request, so it is listed after the archive in the task list.

## 9. Open questions

None. The maintainer decided the points this design had left open:

1. The three adjacent defects (decisions 2.6, 3.3 and 4.2) are in scope.
2. The qualified count line is the usual line wherever the scope's list spans more than one page, until a snapshot read exists (section 2).
3. A budget the gate cannot compare is reported as unverified and exits unsuccessfully (decision 6.7).
4. The release pull request archives the 1.5.0, 1.5.1 and 1.5.2 changes in that order (section 8).
