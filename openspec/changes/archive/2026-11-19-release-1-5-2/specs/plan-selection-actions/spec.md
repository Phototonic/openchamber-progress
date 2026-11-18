## ADDED Requirements

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
