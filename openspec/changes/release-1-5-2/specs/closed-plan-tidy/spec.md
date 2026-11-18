## ADDED Requirements

### Requirement: A bulk count is exact only when its read can show it

A Tidy or Select all count taken from the loaded plan list SHALL be stated as exact only when that list was read in a single page. Otherwise the confirmation SHALL say that some plans may have been missed, on its first step and on the deletion step. A count of named plans, whether chosen rows or a Try again recount, SHALL stay exact. The qualification MUST NOT add a read, and MUST NOT put a plus on a selection count that the incomplete-count rule does not mark.

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
- **AND** the selection bar's count carries no plus, because every matching plan is loaded

#### Scenario: Explicitly chosen rows
- **WHEN** three rows are chosen one by one on a list read in several pages and an action is opened
- **THEN** the confirmation states three plans without qualification

#### Scenario: Try again on a multi-page list
- **WHEN** Try again is chosen after a partial run on a complete list that was read in several pages
- **THEN** the recount states the remaining plans it found without qualification, because it names its plans

#### Scenario: Deletion step
- **WHEN** Delete permanently is chosen from a qualified count
- **THEN** the deletion step repeats that some plans may have been missed

### Requirement: A bulk run completes only into the account and store it ran in

A bulk run SHALL capture the integration account and the store and binding identity when it starts. When it finishes after either changed, it SHALL drop its own state and MUST NOT reset caches, change the selection, close the opened plan or show a result on the board shown then.

#### Scenario: Account switched while a request is held
- **WHEN** the integration account changes while a bulk archive request is held, a plan is opened and selected on the new board, and the held request then answers
- **THEN** the new board keeps its opened plan, its selection and its loaded list, and shows no result line
- **AND** the plans of the earlier run that were never sent stay unsent

#### Scenario: Same identifiers in the new store
- **WHEN** the board shown after the change holds a selected plan with the same source and plan identifier as a target of the earlier run
- **THEN** that plan stays selected and is not treated as archived, restored or deleted

#### Scenario: Board scope changed in the same account and store
- **WHEN** only the board's filters or search changed while the run was in flight
- **THEN** the run stops after the request in flight and reconciles once, as before this change

### Requirement: Cleanup support follows the service's latest answer

Cleanup controls SHALL reflect the cleanup facts of the latest health reply the frame observed. A remembered list scope MUST NOT bring back cleanup support, or in-progress cleanup support, that a later health reply withdrew. Support SHALL return only with a newer health reply that offers it.

#### Scenario: Switching back to a remembered view
- **WHEN** Current plans was read with cleanup support, Archived plans then observes a service without it, and the person switches back to Current plans while its new read is pending
- **THEN** Tidy and Select stay absent while the remembered list is shown

#### Scenario: Loss observed on a failed read
- **WHEN** a refresh receives a health reply without cleanup support and then fails to read the plans, and the person changes to a scope the frame remembers
- **THEN** the remembered list is shown without cleanup controls

#### Scenario: Support returns
- **WHEN** a later health reply offers cleanup again
- **THEN** the controls return with that reply, not earlier

### Requirement: Background cleanup updates do not interrupt the person

A count that finishes by itself, including its failure and the end of a Check more continuation, SHALL repaint as background data, so it waits while a control is held or a picker is open. Explicit actions SHALL still repaint at once, and the change MUST NOT add a timer or defer freshness beyond the existing held-control and open-picker rules.

#### Scenario: Count finishes during a press
- **WHEN** a count finishes between pointer down and pointer up on an unrelated control such as Filters
- **THEN** the control is not replaced before its click, the click takes effect and the count line appears on the next paint

#### Scenario: Explicit action during a count
- **WHEN** the person presses Cancel or Check more while a count is running
- **THEN** the panel repaints at once, as before this change

### Requirement: A deferred cleanup focus move is decided when it is applied

A focus move that cleanup deferred SHALL be applied only if, at the paint that applies it, focus is still inside the cleanup panel or was lost with the removed control. Otherwise the move SHALL be dropped and MUST NOT be kept for a later paint. A move denied because another frame has focus SHALL stay dropped.

#### Scenario: Focus moved before Tidy returns
- **WHEN** a run ends while Stop has focus, the Tidy button is absent during the reconciliation read, and the person focuses Search before that read finishes
- **THEN** focus stays in Search when the Tidy button reappears, and on every later paint

#### Scenario: Focus still owned by the panel
- **WHEN** a run ends while Stop has focus and the person focuses nothing else
- **THEN** focus moves to the Tidy button when it reappears

#### Scenario: Count finishes after focus moved
- **WHEN** a count finishes after the person moved focus from Cancel to Search, and its repaint was delayed by a held control
- **THEN** focus stays in Search

### Requirement: An account or store switch releases pending cleanup controls

After the integration account or the store and binding change, cleanup controls on the board shown SHALL be usable without waiting for a cleanup request sent before the change. That request's late answer MUST NOT complete, release or otherwise change a cleanup action started after the change. This SHALL hold for a single-plan request as for a bulk run, and when the account or store changed and changed back before the answer.

#### Scenario: Tidy after a switch
- **WHEN** the account or store changes while a cleanup request is held, and the person opens Tidy on the new board before that request answers
- **THEN** Tidy opens and counts

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

### Requirement: Run progress does not replace a held control

A progress update of a bulk run SHALL repaint as background data, so it waits while a control is held or a picker is open. The run itself MUST NOT wait for the repaint.

#### Scenario: Stop pressed while a plan is confirmed
- **WHEN** a plan's receipt arrives between pointer down and pointer up on Stop
- **THEN** Stop is not replaced before its click, and the run stops after the request in flight

#### Scenario: Progress still advances
- **WHEN** no control is held and no picker is open during a run
- **THEN** the progress line follows the completed count as before

## MODIFIED Requirements

### Requirement: Honest result with undo

A run SHALL show one progress line with how many of the total are done and a Stop control. Its result SHALL be one line stating how many plans were archived or deleted, how many were skipped and, separately, how many could not be confirmed and may have been applied, and SHALL stay until the next action or refresh, not a timer. A plan whose request was attempted and received no valid answer SHALL be reported as unconfirmed, never as skipped; a plan the run did not attempt MUST NOT be reported as unconfirmed. After Archive the result SHALL offer Undo, which restores each plan this run archived through the existing restore route. A deletion result MUST NOT offer Undo. Archive and Undo MUST NOT change a plan's lifecycle, counts or history. A plan SHALL be reported as done only when its receipt was validated, and a refused or unconfirmed plan MUST NOT be retried automatically.

#### Scenario: All archived
- **WHEN** 128 plans are archived
- **THEN** one line says 128 plans were archived and offers Undo, and the plans leave the current list after one authoritative re-read

#### Scenario: Partial failure
- **WHEN** two of 128 plans were refused as changed
- **THEN** the line says 126 of 128 were archived and two were skipped, with a way to try again for the plans that remain
- **AND** the skipped plans are not retried automatically and are not reported as archived

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
- **AND** an unconfirmed plan that was in fact archived is shown in Archived plans after the reconciliation read, where it can be restored

#### Scenario: Try again after unconfirmed plans
- **WHEN** Try again is chosen after a run with skipped and unconfirmed plans
- **THEN** both are recounted under the existing retry rules before a new confirmation, and a plan that has left the view is left out

#### Scenario: Three languages
- **WHEN** the result line is shown in English, Russian or Simplified Chinese
- **THEN** it distinguishes skipped from unconfirmed plans in that language, as whole sentences with its plural forms

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
