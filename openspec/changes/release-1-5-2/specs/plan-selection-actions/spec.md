## ADDED Requirements

### Requirement: A selection follows confirmed changes during a search

While searching, a freshness reply SHALL certify only the result page it was asked about, identified by that page's number in the search and not by its position among the retained pages. A freshness read sent before a cleanup MUST NOT certify a page or change the selection after that cleanup. A plan that a freshness reply shows missing, deleted or moved across the archive boundary SHALL leave the selection whichever page is shown.

#### Scenario: Load more replaces the page a reply was asked about
- **WHEN** a freshness reply for result page 2 is held, Load more drops page 1 from the retained pages and shows page 3, and the reply then arrives
- **THEN** page 3 is not treated as checked by that reply
- **AND** page 3 is checked only by a reply that covered its own plans

#### Scenario: Reply from before a cleanup
- **WHEN** a freshness reply is held on an unchecked result page under Select all, a matching plan is archived from this frame, and the reply arrives after the run reconciled
- **THEN** the reply changes nothing: the page is not marked checked and the archived plan is not selected again

#### Scenario: Plan confirmed gone while another page is shown
- **WHEN** a selected plan has hits on two retained pages, a freshness reply for page 2 is held, the person goes back to page 1, and the reply shows that another frame archived the plan
- **THEN** the plan's hits leave both pages and the selected count drops by one
- **AND** page 1 stays unchecked until a reply covers it

#### Scenario: Unchanged poll
- **WHEN** a freshness reply shows every covered plan unchanged on the page it was asked about
- **THEN** the selection and the focused row are kept and the page counts as checked

### Requirement: Deselection and departure are kept apart

Under Select all, a plan the person deselected and a plan a cleanup receipt took out of view SHALL be tracked separately. A deselected plan SHALL stay out until the person selects it again or the selection ends. A departed plan SHALL be counted again when an Undo receipt returns it, a verified read lists it, the person clicks its row, or a fresh count finds it in the view at a newer cleanup generation. A cached, unchecked page MUST NOT end a departure.

#### Scenario: Restored elsewhere, then counted again
- **WHEN** a plan is archived from this frame under Select all, the retained search drops it, another frame restores it, and the person opens the next action
- **THEN** the count includes that plan at its current revision and cleanup generation

#### Scenario: Deselected plan stays out
- **WHEN** the person deselected a plan under Select all and a fresh count finds that plan in the view
- **THEN** the plan is left out of the action

#### Scenario: Deselected and departed
- **WHEN** a plan was both deselected by the person and taken out by a receipt, and it returns to the view
- **THEN** it stays out of the action until the person clicks its row

#### Scenario: Still archived
- **WHEN** a departed plan is still archived when the next action in Current plans is counted
- **THEN** it is not in the count

### Requirement: A new search result page starts unchecked

A result page opened by Load more SHALL start unchecked, whatever the state of the page shown before it, and SHALL count as checked only after a freshness reply covered its own plans.

#### Scenario: New page after a checked page
- **WHEN** Load more opens a new result page while the page shown before it was checked
- **THEN** the new page is not treated as checked until a freshness reply has covered its plans
- **AND** the note that results are being checked can show until that reply, at most one refresh interval
