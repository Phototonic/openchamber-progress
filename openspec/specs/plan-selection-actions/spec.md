# plan-selection-actions Specification

## Purpose
Let a person select several plans on the full page, or every plan matching the current search and filters, and archive, restore or delete them together, with in-progress plans acknowledged explicitly.

## Requirements

### Requirement: Several plans can be selected on the full page

The full page SHALL offer a Select mode in which plan rows, and plan results while searching, can be selected and deselected one by one by pointer or keyboard. Each row SHALL expose its name and selected state to assistive technology, with no control nested inside another. Select mode MUST NOT exist on the rail or Work Status.

#### Scenario: Select and deselect
- **WHEN** the user enters Select mode and toggles three plan rows
- **THEN** a bar states that three are selected and offers the actions and Clear
- **AND** leaving Select mode or choosing Clear empties the selection

#### Scenario: Keyboard and screen reader
- **WHEN** a keyboard user moves through the rows in Select mode
- **THEN** Space toggles the focused row, its selected state is exposed, and a change in the selected count is announced once per action

#### Scenario: Phone width
- **WHEN** the full page is narrower than 820 CSS pixels, where browsing shows no plan rows
- **THEN** Select shows the plan rows for selection in place of the plan, with a way back, without horizontal overflow and with targets of at least 44 CSS pixels on a coarse pointer

#### Scenario: Rail and Work Status
- **WHEN** the rail or Work Status is shown
- **THEN** neither offers Select mode

### Requirement: A selection belongs to one board reading

The selection SHALL be frame-local and SHALL survive background refreshes. It SHALL be cleared when the account, store, binding, current or archived view, filters or search change. It MUST NOT be stored.

#### Scenario: Refresh keeps the selection
- **WHEN** a background refresh arrives while plans are selected
- **THEN** the selection and the focused row are kept
- **AND** a selected plan that left the reading is no longer counted

#### Scenario: Reading changes
- **WHEN** the user changes a filter, runs or clears a search, or switches between Current and Archived plans
- **THEN** the selection is cleared

#### Scenario: Reload
- **WHEN** the frame is reloaded
- **THEN** nothing is selected

### Requirement: Every matching plan can be selected at once

Select mode SHALL offer Select all, which selects every plan matching the current search and filters, or every plan of the current view when none are set, including plans that are not loaded. The stated count MUST NOT be presented as exact while it may be low.

#### Scenario: Everything, with nothing set
- **WHEN** Select all is chosen with no search or filter
- **THEN** every plan of the current view is selected, including plans inside closed Finished folds and plans not loaded

#### Scenario: Matching a filter or search
- **WHEN** Select all is chosen while a filter or search is set
- **THEN** only the matching plans are selected

#### Scenario: Count before the scan
- **WHEN** some matching plans are not loaded and the action panel has not counted them yet
- **THEN** the selected count carries a plus mark
- **AND** opening an action counts them through a bounded scan and states the number it will act on

#### Scenario: Deselecting after Select all
- **WHEN** the user deselects one loaded row after Select all
- **THEN** that plan is left out of the action and the count drops by one

### Requirement: Selection actions work on plans of any status

With at least one plan selected, the full page SHALL offer Archive and Delete permanently in Current plans, and Restore and Delete permanently in Archived plans, for plans of any status. These actions SHALL follow Tidy's confirmation, run, progress, result and Undo rules.

#### Scenario: Archive a mixed selection
- **WHEN** the user archives 14 selected plans of which three are in progress
- **THEN** after confirming, all 14 are archived and the result offers Undo, which restores the three as in progress

#### Scenario: Delete a selection
- **WHEN** the user chooses Delete permanently for the selected plans
- **THEN** a second step states the count and that it cannot be undone, and only its own button starts deleting

#### Scenario: Restore in Archived plans
- **WHEN** the user selects archived plans, including one that was in progress, and chooses Restore
- **THEN** each is restored with its lifecycle unchanged and the in-progress one accepts reports again

#### Scenario: A selected plan changes before its request
- **WHEN** an agent reports to a selected plan between confirmation and its request
- **THEN** that plan is skipped as changed and reported as not done

### Requirement: In-progress plans in a selection are acknowledged explicitly

When a selection includes in-progress plans, the confirmation's one line SHALL state how many and what follows. Each Archive or Delete permanently request for an in-progress plan SHALL carry the in-progress acknowledgement, and no other request SHALL carry it. Restore requests, including Undo of an archive, SHALL never carry it, whatever the plan's lifecycle. Without the service capability, in-progress plans SHALL be left out and the line SHALL say how many.

#### Scenario: Archive warning
- **WHEN** three of 14 selected plans are in progress and the user chooses Archive
- **THEN** the confirmation states that three are still in progress and stop updating until restored

#### Scenario: Delete warning
- **WHEN** three of 14 selected plans are in progress and the user chooses Delete permanently
- **THEN** the deletion step states that three are still in progress and that it cannot be undone

#### Scenario: Acknowledgement only where needed
- **WHEN** the run sends its requests
- **THEN** the three requests for in-progress plans carry the acknowledgement and the eleven for closed plans do not

#### Scenario: Restore never acknowledges
- **WHEN** the user restores a selection, or uses Undo after archiving, and it includes plans that were in progress
- **THEN** no restore request carries the acknowledgement, and each is restored with its lifecycle unchanged

#### Scenario: Service without in-progress cleanup
- **WHEN** the service does not advertise in-progress cleanup and the selection includes three in-progress plans
- **THEN** the confirmation says three in-progress plans are left out, no request is sent for them and the others proceed

### Requirement: An archived in-progress plan can be restored or deleted on its own

The selected plan's contextual cleanup controls, outside More, SHALL offer Restore and eligible Delete permanently for an archived plan whatever its lifecycle. For a visible closed plan they SHALL offer the existing Archive and Delete permanently actions. A visible in-progress plan MUST NOT gain per-plan cleanup: only the board's explicit selection flow can clean it up. Existing confirmations, capability gates, target binding and destructive consequences SHALL remain unchanged.

#### Scenario: Restore from More
- **WHEN** an archived in-progress plan is shown in Archived plans
- **THEN** Restore has moved out of More to the plan's contextual controls beside capability-gated Delete permanently, and Restore returns it to Current plans as in progress

#### Scenario: Delete declined
- **WHEN** the reader opens the plan's deletion confirmation and presses Escape
- **THEN** no request is sent and focus returns to the eligible deletion opener, not an unrelated menu

#### Scenario: Visible in-progress plan
- **WHEN** an unarchived in-progress plan is shown on rail or board
- **THEN** neither the header nor the contextual cleanup area offers single-plan Archive or Delete

### Requirement: A selection follows confirmed changes during a search

While searching, a freshness reply SHALL certify only the result page it was asked about, identified by its number in the search and not by its position among the retained pages, and only when it covered every plan that page shows when the reply arrives. Hits the search reads into a page after it was checked SHALL leave it checked. A plan that a freshness reply shows missing, deleted or moved across the archive boundary SHALL leave the selection whichever page is shown.

#### Scenario: Load more replaces the page a reply was asked about
- **WHEN** a freshness reply for result page 2 is held, Load more drops page 1 from the retained pages and shows page 3, and the reply then arrives
- **THEN** page 3 is not treated as checked by that reply
- **AND** page 3 is checked only by a reply that covered its own plans

#### Scenario: Hits appended while a reply is held
- **WHEN** a freshness reply for an unchecked result page is held, the search appends further hits to that same page, and the reply then arrives with every covered plan unchanged
- **THEN** the page is not counted as checked by that reply
- **AND** it counts as checked once a reply has covered the plans it then shows

#### Scenario: Hits read after a page was checked
- **WHEN** a freshness reply has certified a result page and the running search then reads further hits into that page
- **THEN** the page stays checked: those hits were read from the service at that moment, as the hits on the first page of a search are
- **AND** the next freshness read covers the plans the page then shows

#### Scenario: Plan confirmed gone while another page is shown
- **WHEN** a selected plan has hits on two retained pages, a freshness reply for page 2 is held, the person goes back to page 1, and the reply shows that another frame archived the plan
- **THEN** the plan's hits leave both pages and the selected count drops by one
- **AND** page 1 stays unchecked until a reply covers it

#### Scenario: Unchanged poll
- **WHEN** a freshness reply covered every plan shown on the page it was asked about and shows them unchanged
- **THEN** the selection and the focused row are kept and the page counts as checked

### Requirement: A cleanup in this frame retires freshness reads in flight

When a cleanup action in this frame invalidates the search, the freshness reads the frame already sent SHALL be retired: their replies MUST NOT certify a page or change the selection. A cleanup made elsewhere that this frame has not observed retires nothing; a freshness reply that shows its effect is evidence like any other.

#### Scenario: Reply from before a cleanup
- **WHEN** a freshness reply is held on an unchecked result page under Select all, a matching plan is archived from this frame, and the reply arrives after the run reconciled
- **THEN** the reply changes nothing: the page is not marked checked and the archived plan is not selected again

#### Scenario: Archive made in another frame
- **WHEN** a freshness read is in flight while another frame archives a selected plan, and its reply shows the plan archived
- **THEN** the plan leaves the selection and the retained pages, as for any plan a reply shows gone

### Requirement: Deselection and departure are kept apart

Under Select all, a plan the person deselected and a plan a cleanup receipt took out of view SHALL be tracked separately. Both SHALL last until the person clicks the plan's row, replaces the selection with Select all or ends it. A departure SHALL also end when an Undo receipt returns the plan, a verified read lists it, or a fresh count finds it in the view at a newer cleanup generation; none of these SHALL end a deselection. A cached, unchecked page MUST NOT end a departure.

#### Scenario: Restored elsewhere, then counted again
- **WHEN** a plan is archived from this frame under Select all, the retained search drops it, another frame restores it, and the person opens the next action
- **THEN** the count includes that plan at its current revision and cleanup generation

#### Scenario: Deselected plan stays out
- **WHEN** the person deselected a plan under Select all and a fresh count finds that plan in the view
- **THEN** the plan is left out of the action

#### Scenario: Deselected and departed
- **WHEN** a plan was both deselected by the person and taken out by a receipt, and an Undo receipt, a verified read or a fresh count returns it to the view
- **THEN** its departure ends and it stays out of the action as a deselected plan, until the person clicks its row or replaces the selection with Select all

#### Scenario: Select all pressed again
- **WHEN** the person presses Select all again after deselecting plans
- **THEN** the selection is replaced and those plans are selected again, as before this change

#### Scenario: Still archived
- **WHEN** a departed plan is still archived when the next action in Current plans is counted
- **THEN** it is not in the count

### Requirement: A new search result page starts unchecked

A result page opened by Load more SHALL start unchecked, whatever the state of the page shown before it, and SHALL count as checked only after a freshness reply covered its own plans. A page that shows no plan has nothing to check and MUST NOT show the checking note.

#### Scenario: New page after a checked page
- **WHEN** Load more opens a new result page while the page shown before it was checked
- **THEN** the new page is not treated as checked until a freshness reply has covered its plans
- **AND** the note that results are being checked can show until then, with no time limit; a failed freshness read leaves the page unchecked and is reported by the existing stale indication

#### Scenario: Load more finds nothing
- **WHEN** Load more opens a new result page and the search ends without a hit for it
- **THEN** the page shows no checking note, and no freshness read is added for it

### Requirement: A Select all count states the plans the frame has loaded

Under Select all, the selection bar's count SHALL be the number of selected plans the frame has loaded. It SHALL carry a plus mark only while matching plans are known not to be loaded, as before this change, and MUST NOT gain one because the list was read in several pages. The count is not a verified total of matching plans: where a list read in several pages may have missed a plan, the confirmation SHALL say so before any request.

#### Scenario: Complete list read in several pages
- **WHEN** Select all is active on a complete list that was read in several pages
- **THEN** the selection bar states the number of selected plans the frame has loaded, without a plus
- **AND** an action opened from it says that some plans may have been missed

#### Scenario: Matching plans not loaded
- **WHEN** Select all is active while matching plans are not loaded
- **THEN** the selected count carries a plus mark, as before this change
