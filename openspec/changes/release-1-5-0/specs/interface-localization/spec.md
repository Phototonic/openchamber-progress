## MODIFIED Requirements

### Requirement: Accessible switch outside plan content

The side panel and full-screen page SHALL offer the language choice as a Language / "Язык" / "语言" entry of the More menu, opening a single-choice list of automatic, English, "Русский" and "简体中文". The entry SHALL remain available without a plan, before setup is complete and during loading errors. Work Status SHALL apply the shared choice without its own switch. Language names SHALL be displayed in their own languages, without flags.

#### Scenario: Extension not yet set up
- **WHEN** the user opens the side panel or page before setup is complete
- **THEN** the More menu and its Language entry are present outside the setup form and do not require a successful progress read

#### Scenario: Empty or unavailable content
- **WHEN** no session is selected, no plans exist or reading progress has failed
- **THEN** the Language entry remains in the panel's and page's More menu

#### Scenario: Compact view
- **WHEN** Work Status is displayed
- **THEN** its interface uses the shared selected language but contains no separate language switch

#### Scenario: Choosing in the menu
- **WHEN** the user picks a language from the list with the keyboard
- **THEN** the chosen entry shows as selected and keeps focus, and the list is not closed by an external language update

### Requirement: Behavior without device storage support

If the host does not support device storage, the extension SHALL follow the OpenChamber language and explain that saving and manual selection are unavailable. The Language entry SHALL remain in the More menu with its choices disabled and one accessible line of explanation. The extension MUST NOT create a temporary manual choice for an individual view, send unsupported device storage requests or fall back to shared server storage.

#### Scenario: Host does not advertise support
- **WHEN** the host does not report device storage support
- **THEN** all three views use automatic mode
- **AND** the panel's and page's Language list shows its choices disabled with one line saying the interface follows the OpenChamber language, without making device storage requests or writing a server setting

## ADDED Requirements

### Requirement: Plain-language visible copy in three languages

Default visible text and accessible names SHALL use plain words and one sentence per notice, in English, Russian and Simplified Chinese changed together. Internal terms for source, store, revision, coverage, binding, capture, reported, contribution, companion and observation MUST NOT appear there; they MAY appear in Advanced details, the support summary and Setup's disclosure. Text an agent wrote SHALL be shown literally and never translated or reworded.

#### Scenario: Internal terms
- **WHEN** the rail, board, Work Status and Setup are rendered in their default states in each language
- **THEN** no visible string or accessible name contains a listed internal term or its Russian or Chinese catalog equivalent
- **AND** state words read as in progress, blocked, waiting on earlier tasks and done

#### Scenario: Same change, three languages
- **WHEN** a pull request adds or rewords an extension-owned string
- **THEN** the English, Russian and Simplified Chinese catalogs change together, keeping their established product terms

#### Scenario: Counts and plurals
- **WHEN** a count of 1, 2, 5, 11 or 21 is shown, with or without a plus mark
- **THEN** the string is built whole with the language's plural rule, the plus mark follows the number without a space, and no fragment is concatenated around the number

#### Scenario: Agent text
- **WHEN** a task title, reason or next action written by an agent is shown, including inside a copied reply
- **THEN** it appears unchanged, as text only, with only the surrounding extension-owned words translated

#### Scenario: Narrow widths
- **WHEN** the longest strings of the new components render at 390 CSS pixels on the rail and 280 CSS pixels in Work Status in each language
- **THEN** they wrap without horizontal overflow and without truncating a control's name
