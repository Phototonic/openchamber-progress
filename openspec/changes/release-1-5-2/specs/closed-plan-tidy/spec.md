## ADDED Requirements

### Requirement: A bulk count is exact only when its read can show it

A Tidy or Select all count taken from the loaded plan list SHALL be stated as exact only when that list was read in a single page. Otherwise the confirmation SHALL say that some plans may have been missed, on its first step and on the deletion step. A count of rows explicitly chosen from that list SHALL stay exact. A Try again recount from a list read in several pages SHALL stay exact only when it found every plan it names. The qualification MUST NOT add a read.

#### Scenario: List read in several pages
- **WHEN** Tidy is opened on a complete list of 120 plans that was read in three pages
- **THEN** the count line states the number found and that some plans may have been missed
- **AND** no request is sent to produce the count

#### Scenario: List read in one page
- **WHEN** Tidy is opened on a complete list of 30 plans that was read in one page
- **THEN** the count line states the number without qualification

#### Scenario: Select all on a multi-page list
- **WHEN** Select all is active on a complete list read in several pages and an action is opened
- **THEN** the confirmation says that some plans may have been missed

#### Scenario: Explicitly chosen rows
- **WHEN** three rows are chosen one by one on a complete list read in several pages and an action is opened
- **THEN** the confirmation states three plans without qualification

#### Scenario: Chosen rows counted by a scan
- **WHEN** rows are chosen in a searched or truncated scope, where the count runs through a scan
- **THEN** the scan's existing qualification and Check more rules apply unchanged, also on an older service, whose list scan cannot vouch for what crossed its cursor

#### Scenario: Try again finds every named plan
- **WHEN** Try again is chosen after a partial run on a complete list that was read in several pages, and every remaining plan is among the loaded rows
- **THEN** the recount states those plans without qualification

#### Scenario: Try again does not find a named plan
- **WHEN** Try again is chosen on a complete list that was read in several pages, and a remaining plan is not among the loaded rows
- **THEN** the recount states the plans it found and that some plans may have been missed, because that read cannot show whether the plan left the view or was missed
- **AND** no request is sent to look for it

#### Scenario: Try again on a list read in one page
- **WHEN** Try again is chosen on a complete list that was read in one page, and a remaining plan is not among its rows
- **THEN** the recount states the plans it found without qualification

#### Scenario: Deletion step
- **WHEN** Delete permanently is chosen from a qualified count
- **THEN** the deletion step repeats that some plans may have been missed

### Requirement: A bulk run completes only into the account and store it ran in

A bulk run SHALL capture the integration account and the store and binding identity when it starts. When it finishes after the frame observed a change of either, even one that has since changed back, it SHALL drop its own state and MUST NOT reset caches, change the selection, close the opened plan or show a result on the board shown then. A validated Delete receipt SHALL still remove the device review marker captured for its plan in the account and store the run started in.

#### Scenario: Account switched while a request is held
- **WHEN** the integration account changes while a bulk archive request is held, a plan is opened and selected on the new board, and the held request then answers
- **THEN** the new board keeps its opened plan, its selection and its loaded list, and shows no result line
- **AND** the plans of the earlier run that were never sent stay unsent

#### Scenario: Same identifiers in the new store
- **WHEN** the board shown after the change holds a selected plan with the same source and plan identifier as a target of the earlier run
- **THEN** that plan stays selected and is not treated as archived, restored or deleted

#### Scenario: Account switched away and back while a request is held
- **WHEN** the integration account changes and changes back while a bulk archive request is held, a plan is opened on the board shown, no newer run is started, and the held request then answers
- **THEN** that board keeps its opened plan, its selection and its loaded list, and shows no result line

#### Scenario: Delete receipt arrives after the switch
- **WHEN** the integration account changes while a bulk delete request is held, and the request then answers with a valid receipt
- **THEN** the review marker stored for that plan under the account and store the run started in is removed
- **AND** the markers of other plans, and of the same plan identifier under another account, stay

#### Scenario: Board scope changed in the same account and store
- **WHEN** only the board's filters or search changed while the run was in flight
- **THEN** the run stops after the request in flight, shows no result line and sends its one reconciliation read when it ends, as the interface did before this change

#### Scenario: Store changed during a run without the frame observing it
- **WHEN** the store changes with no account change while a bulk run has the list reads paused
- **THEN** the run ends on the board it started on, and the list read that follows it adopts the new store and clears that board, as before this change

#### Scenario: Store change observed after a board change resumed list reads
- **WHEN** the board's filters change while a bulk request is held, so list reads resume, a list reply then shows that the store changed, and the held request answers
- **THEN** the board shown keeps its loaded list and its selection, and shows no result of that run

### Requirement: Cleanup support follows the service's latest answer

Cleanup controls SHALL follow the cleanup facts of the latest health reply the frame accepted, whichever list is shown. Showing a remembered list scope MUST NOT bring back cleanup support, or in-progress cleanup support, that a later health reply withdrew, and MUST NOT hide support that a later health reply granted. A health reply is accepted when the refresh that read it settles, whether its list read completed or failed.

#### Scenario: Switching back to a remembered view
- **WHEN** Current plans was read with cleanup support, Archived plans then observes a service without it, and the person switches back to Current plans while its new read is pending
- **THEN** Tidy and Select stay absent while the remembered list is shown

#### Scenario: Loss observed on a failed read
- **WHEN** a refresh receives a health reply without cleanup support and then fails to read the plans, and the person changes to a scope the frame remembers
- **THEN** the remembered list is shown without cleanup controls

#### Scenario: Support returns
- **WHEN** a later health reply offers cleanup again
- **THEN** the controls return with that reply, not earlier

#### Scenario: Support granted after a view was remembered
- **WHEN** one view of Current plans was last read while the service offered no cleanup, a later refresh in another view of Current plans, such as the same list under a session filter, accepts a health reply that offers it, and the person switches back to the first view while its new read is pending
- **THEN** Tidy and Select are offered while the remembered list of the first view is shown

### Requirement: Background cleanup updates do not interrupt the person

A count that finishes by itself, including its failure and the end of a Check more continuation, SHALL repaint as background data, so it waits while a control is held or a picker is open. Explicit actions SHALL still repaint at once, and the change MUST NOT add a timer or defer freshness beyond the existing held-control and open-picker rules.

#### Scenario: Count finishes during a press
- **WHEN** a count finishes between pointer down and pointer up on an unrelated control such as Filters
- **THEN** the control is not replaced before its click, the click takes effect and the count line appears on the next paint

#### Scenario: Explicit action during a count
- **WHEN** the person presses Cancel or Check more while a count is running
- **THEN** the panel repaints at once, as before this change

### Requirement: A deferred cleanup focus move is decided when it is applied

A focus move that cleanup deferred SHALL be applied only if, at the paint that applies it, focus is still on the control the move was queued from, or is on no control because that control was removed. If the person has focused anything else, inside the cleanup panel or outside it, the move SHALL be dropped and MUST NOT be kept for a later paint. A move denied because another frame has focus SHALL stay dropped.

#### Scenario: Focus moved before Tidy returns
- **WHEN** a run ends while Stop has focus, the Tidy button is absent during the reconciliation read, and the person focuses Search before that read finishes
- **THEN** focus stays in Search when the Tidy button reappears, and on every later paint

#### Scenario: Focus moved to Undo before Tidy returns
- **WHEN** a run ends while Stop has focus, the result line offers Undo while the Tidy button is absent during the reconciliation read, and the person focuses Undo before that read finishes
- **THEN** focus stays on Undo for as long as Undo is shown, also when the Tidy button reappears
- **AND** the dropped move to the Tidy button is not applied later, also after the result expires and Undo is removed

#### Scenario: Focus lost with the removed control
- **WHEN** a run ends while Stop has focus and the person focuses nothing else
- **THEN** focus moves to the Tidy button when it reappears

#### Scenario: Count finishes after focus moved
- **WHEN** a count finishes after the person moved focus from Cancel to Search, and its repaint was delayed by a held control
- **THEN** focus stays in Search

### Requirement: An account or store switch releases pending cleanup controls

After the frame observes a change of the integration account or of the store and binding, cleanup controls on the board shown SHALL be usable without waiting for a cleanup request sent before the change. That request's late answer MUST NOT complete, release or otherwise change a cleanup action started after the change. This SHALL hold for a single-plan request as for a bulk run, and when the account or store changed and changed back before the answer.

#### Scenario: Tidy after a switch
- **WHEN** the account changes while a cleanup request is held, and the person opens Tidy on the new board before that request answers
- **THEN** Tidy opens and counts

#### Scenario: Store change observed during a single-plan request
- **WHEN** a single-plan cleanup request is held and a list reply shows that the store changed
- **THEN** cleanup controls on the board shown after that reply are usable before the held request answers

#### Scenario: Late answer during a newer run
- **WHEN** the earlier request answers while a run started on the new board is in flight
- **THEN** the newer run stays pending until its own requests finish and cannot be confirmed a second time

#### Scenario: Single-plan request held across a switch
- **WHEN** a single-plan cleanup request is held, the account changes, a Tidy run is started on the new board, and the held request then answers
- **THEN** the Tidy run completes and shows its own result
- **AND** the late answer shows no message and resets nothing on the new board

#### Scenario: Switched away and back
- **WHEN** the account changes and changes back while a cleanup request is held, a new run is started, and the held request then answers
- **THEN** the late answer neither completes nor releases the new run

### Requirement: A run's own updates do not replace a held control

A progress update of a bulk run, and the repaint at its end with the result line and the selection changes its receipts cause, SHALL repaint as background data, so they wait while a control is held or a picker is open. The run itself, the release of its busy state, its cache invalidation and its reconciliation read MUST NOT wait for the repaint. A refresh MUST NOT expire a result that has not been painted yet.

#### Scenario: Stop pressed while a plan is confirmed
- **WHEN** a plan's receipt arrives between pointer down and pointer up on Stop, and requests remain
- **THEN** Stop is not replaced before its click, and the run stops after the request in flight

#### Scenario: Last reply arrives during a press
- **WHEN** the run's last reply arrives between pointer down and pointer up on an unrelated control
- **THEN** that control is not replaced while it is held, and the result line appears on the next paint
- **AND** the reconciliation read is sent without waiting for that paint
- **AND** a held control of the board whose data the run invalidated, such as Filters, stays in place and ignores that click, as after any cache reset

#### Scenario: Hold lasts past the next refresh
- **WHEN** the run's last reply arrives while a control is held or a picker is open, and the hold lasts past the next refresh
- **THEN** that refresh does not expire the result, and the result line, with Undo after an archive, appears on the paint after the hold ends
- **AND** the refresh after that paint expires it, as before this change

#### Scenario: Progress still advances
- **WHEN** no control is held and no picker is open during a run
- **THEN** the progress line follows the completed count, and the result line appears when the run ends, as before this change

### Requirement: The result separates skipped plans from unconfirmed ones

The result line SHALL state how many plans were archived, restored or deleted, how many were skipped and, separately, how many could not be confirmed and may have been applied. A plan whose request was attempted and received no valid answer SHALL be reported as unconfirmed, never as skipped. A plan the run did not attempt MUST NOT be reported as unconfirmed. Undo SHALL restore only plans with a validated archive receipt.

#### Scenario: Reply lost
- **WHEN** the reply to one of 128 archive requests is lost or times out and the other 127 are archived
- **THEN** the line says 127 of 128 were archived and that one could not be confirmed and may have been archived
- **AND** that plan is not reported as skipped, is not reported as archived and is not retried automatically

#### Scenario: Skipped and unconfirmed together
- **WHEN** one plan was refused as changed and the replies for two others were lost
- **THEN** the line states the archived count, one skipped and two that could not be confirmed, in one sentence

#### Scenario: Stopped before sending
- **WHEN** the run is stopped with plans not yet sent
- **THEN** those plans count as skipped, never as unconfirmed

#### Scenario: Attempt that failed before reaching the service
- **WHEN** the run attempts a plan's request and it fails while being prepared or handed over, before the service could receive it
- **THEN** the plan is reported as unconfirmed, because the run cannot tell this failure from a lost reply

#### Scenario: Unconfirmed plans and Undo
- **WHEN** Undo is chosen after a run with unconfirmed plans
- **THEN** only the plans with a validated archive receipt are restored
- **AND** an unconfirmed plan that was in fact archived is not restored by Undo; it can be restored on its own once an Archived plans list or search shows it

#### Scenario: Try again after unconfirmed plans
- **WHEN** Try again is chosen after an archive, a deletion or a restore of selected plans that left skipped and unconfirmed plans
- **THEN** both are recounted under the existing retry rules before a new confirmation, and a plan that has left the view is left out

#### Scenario: Try again after a partial Undo
- **WHEN** Undo restored some plans, others were skipped or could not be confirmed, and Try again is chosen
- **THEN** the restore is sent again for exactly those remaining plans, each still bound to the revision and cleanup generation its archive receipt returned, without a recount in the view shown
- **AND** a plan whose earlier restore was in fact applied is confirmed as restored from the receipt the service saved for that same request, and is not restored twice
- **AND** a plan that another cleanup changed since is refused, left as it is and reported as skipped

#### Scenario: Three languages
- **WHEN** the result line is shown in English, Russian or Simplified Chinese
- **THEN** it distinguishes skipped from unconfirmed plans in that language, as whole sentences with its plural forms

## MODIFIED Requirements

### Requirement: Explicit confirmation before any request

Opening Tidy SHALL show an inline panel, not a modal, whose one short line states how many plans are in scope and whose buttons name the action and the count. It MUST NOT list plan titles. Cancel SHALL have initial focus, Enter MUST NOT confirm by default and Escape SHALL cancel. No archive, restore or delete request SHALL be sent on opening or cancelling. The deletion step SHALL keep what deletion removes and keeps reachable in one collapsed disclosure.

#### Scenario: Cancel
- **WHEN** the user opens the panel and presses Escape or Cancel
- **THEN** no cleanup request is sent and focus returns to the Tidy button

#### Scenario: Confirm
- **WHEN** the user activates the archive button
- **THEN** each plan in scope is archived through the existing per-plan archive route, bound to the progress revision and cleanup generation captured for it, one request at a time

#### Scenario: Counting plans that are not loaded
- **WHEN** the scope reaches beyond the loaded list
- **THEN** the panel shows that it is counting, sends only reads, and can be cancelled before the count arrives

#### Scenario: More than one run covers
- **WHEN** at least 1,000 matching plans are collected and more remain
- **THEN** the line says it covers the first 1,000 of more, and the rest can be done by using Tidy again

#### Scenario: Scan limit reached first
- **WHEN** the scan reaches its 2,000-plan limit having collected fewer than 1,000 matching plans
- **THEN** the line states the number actually found and that more plans weren't checked, without claiming more matches exist, and offers Check more

#### Scenario: Check more continues past checked plans
- **WHEN** the user chooses Check more after the scan limit
- **THEN** the scan continues from where it stopped in the same reading, reading up to 2,000 further plans and adding their matches to the count, never re-reading plans it already checked
- **AND** a change of store, account, binding, view, search or filters discards the continuation, so the next scan starts from the beginning

#### Scenario: Deletion details
- **WHEN** the user expands the disclosure in the deletion step
- **THEN** it states that stored tasks, history and the document copy are removed, the original file is kept, and deletion is not secure erasure

#### Scenario: Context changes mid-run
- **WHEN** the frame observes a change of the store, account, binding or board reading while requests remain
- **THEN** no further request is sent and no plan is reported as done without its validated receipt
- **AND** after a change of board reading in the same account, store and binding the run shows no result line and sends its one reconciliation read when it ends

#### Scenario: Account, store or binding changes mid-run
- **WHEN** the frame observes a change of the account, store or binding while requests remain
- **THEN** the board shown after the change shows no result of that run and is not changed by it

### Requirement: Honest result with undo

A run SHALL show one progress line with how many of the total are done, and Stop. Its result SHALL be one line, kept until the next action or refresh, not a timer. After Archive it SHALL offer Undo, which restores each plan this run archived through the restore route; a deletion result MUST NOT offer Undo. Archive and Undo MUST NOT change a plan's lifecycle, counts or history. A plan SHALL be reported as done only when its receipt was validated, and no plan SHALL be retried automatically.

#### Scenario: All archived
- **WHEN** 128 plans are archived
- **THEN** one line says 128 plans were archived and offers Undo, and the plans leave the current list after one authoritative re-read

#### Scenario: Partial failure
- **WHEN** two of 128 plans were refused as changed
- **THEN** the line says 126 of 128 were archived and two were skipped, with a way to try again for the plans that remain
- **AND** the skipped plans are not retried automatically and are not reported as archived

#### Scenario: Stop
- **WHEN** the user chooses Stop during a run
- **THEN** no further request is sent after the one in flight, and the result states how many were done before stopping

#### Scenario: Undo
- **WHEN** the user chooses Undo
- **THEN** each plan this run archived is restored with its lifecycle unchanged, bound to the cleanup generation its archive returned
- **AND** a plan that changed since is left as it is and reported

#### Scenario: Deleted
- **WHEN** 128 plans are deleted
- **THEN** one line says 128 plans were deleted and no Undo is offered

#### Scenario: Keyboard and announcement
- **WHEN** a run starts and completes
- **THEN** its start and its result are each announced once, individual plans are not announced, and Stop and Undo are reachable by keyboard without moving focus unexpectedly
