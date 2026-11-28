## MODIFIED Requirements

### Requirement: Tidy is always available on the full page

The board SHALL offer one Tidy entry next to Finished, outside any project's fold or listbox, for the existing board-wide scope. Without visible Finished rows it SHALL remain at the list/results boundary, including on narrow screens. Search, filtering or no eligible plans MUST NOT hide it. Existing freshness, capability, confirmation and result rules SHALL remain unchanged; neither rail nor menus offer bulk cleanup.

#### Scenario: Library with more than one project
- **WHEN** several projects have finished rows and the reader opens Tidy
- **THEN** one action identifies and counts eligible closed plans in the current board scope, not just those under the nearest Finished fold; opening or cancelling sends no mutation

#### Scenario: While searching or filtering
- **WHEN** eligible cleanup is available in a search, a filtered scope or Archived plans without a visible Finished fold
- **THEN** Tidy remains reachable and keeps that scope; a retired search cannot authorize cleanup

#### Scenario: Nothing to tidy
- **WHEN** Tidy opens with no eligible plan
- **THEN** one line states the existing qualified result, no cleanup action is offered and nothing is mutated

#### Scenario: Service without cleanup
- **WHEN** the service does not advertise cleanup
- **THEN** Tidy is absent

#### Scenario: Rail and More
- **WHEN** the rail or the menus on either surface are opened
- **THEN** there is no bulk cleanup entry; eligible single-plan actions remain available on the plan itself

#### Scenario: Phone width and keyboard
- **WHEN** the board is 390 CSS pixels wide or operated by keyboard
- **THEN** Tidy is named, reachable outside collapsed rows and at least 44 CSS pixels on a coarse pointer, without horizontal overflow
