# interface-localization Specification

## Purpose

Give users one language choice for the Agent Progress interface and its generated summaries within a profile and extension installation, while preserving original user text, machine contracts and progress reading state.

## Requirements

### Requirement: Language choice and following the OpenChamber language

The extension SHALL offer automatic, English, Russian and Simplified Chinese modes, defaulting to automatic without a saved choice. Automatic mode SHALL use Russian for Russian locales and regional variants, the single Simplified Chinese catalog for all Chinese locales and regional variants, and English for English, unsupported or invalid tags. An explicit choice SHALL override the OpenChamber language.

#### Scenario: Automatic mode for a Chinese locale
- **WHEN** the saved choice is absent or automatic and OpenChamber reports the language `zh-CN` or `zh-SG`
- **THEN** the interface and generated summaries use Simplified Chinese

#### Scenario: Automatic mode for a regional variant
- **WHEN** the saved choice is absent or automatic and OpenChamber reports the language `ru-RU`
- **THEN** the interface and generated summaries use Russian

#### Scenario: Unsupported OpenChamber language
- **WHEN** automatic mode is selected and OpenChamber reports `de-DE` or an invalid language tag
- **THEN** the extension uses English without a rendering error

#### Scenario: OpenChamber language change
- **WHEN** the OpenChamber language changes from English to Russian while a view is open
- **THEN** automatic mode switches the extension language to Russian, while explicitly selected English remains English
- **AND** the saved automatic mode is not replaced with a computed explicit choice

### Requirement: Accessible switch outside plan content

The rail and board SHALL offer the language choice in Settings, outside plan More, opening the existing single-choice list of automatic, English, Русский and 简体中文. Settings and its language entry SHALL remain available without a plan, before setup completes and during loading or failure. Work Status SHALL apply the shared choice without its own switch. Language names SHALL remain in their own languages, without flags.

#### Scenario: Extension not yet set up
- **WHEN** the reader opens Settings before setup
- **THEN** Language is accessible outside the setup form without requiring a successful progress read

#### Scenario: Empty or unavailable content
- **WHEN** no session is selected, no plans exist or the progress read failed
- **THEN** Settings still offers Language on the panel and page

#### Scenario: Compact view
- **WHEN** Work Status is displayed
- **THEN** it uses the shared interface language without a selector

#### Scenario: Choosing in the menu
- **WHEN** the reader chooses a language by keyboard
- **THEN** the chosen entry shows as selected and keeps focus; an external language update does not dismiss the open list

### Requirement: Save the choice in the device profile

The extension SHALL save one shared language choice in device-scoped storage for the profile, runtime and extension installation. The choice SHALL survive closing a view and reloading. It SHALL be independent of the plan, session, project, progress source and integration account. The extension MUST NOT save the language in shared server storage or promise isolation between people using the same profile.

#### Scenario: Reopening and switching context
- **WHEN** the user successfully saves Russian, reloads the interface and selects another session or project
- **THEN** the panel, page and Work Status in the same device storage scope use Russian after successfully reading the setting

#### Scenario: Independent profiles
- **WHEN** the user saves Russian in one profile and another profile has no saved choice
- **THEN** the first profile's setting does not change the second profile's choice, which follows its own OpenChamber language

### Requirement: Behavior without device storage support

Without device storage the extension SHALL follow the host language. The Language entry SHALL remain in Settings with choices disabled and one accessible explanation. It MUST NOT create a temporary manual choice, make unsupported device requests or fall back to shared server storage.

#### Scenario: Host does not advertise support
- **WHEN** the host lacks device storage
- **THEN** all three surfaces use automatic mode, and both Settings menus explain the disabled choices without requesting or saving them

### Requirement: Save failures do not look like a successful choice

The extension SHALL distinguish an absent setting from a read failure or invalid value. On failure, the last confirmed choice SHALL be retained; if none exists, automatic mode SHALL apply. A failed write MUST NOT be confirmed as saved; the previous confirmed choice SHALL remain effective. The message SHALL explain the failure without displaying arbitrary storage error text.

#### Scenario: Failed write
- **WHEN** the user selects Russian while English is confirmed and saving fails
- **THEN** English remains effective, the interface reports the failure and allows a retry
- **AND** no successful-save message appears

#### Scenario: First read unavailable
- **WHEN** no setting has yet been confirmed and reading fails or returns an unsupported value
- **THEN** the extension uses automatic mode and reports that the saved setting could not be read
- **AND** the invalid value is not executed, displayed as a language or overwritten automatically

#### Scenario: Failure after a successful read
- **WHEN** a subsequent setting check fails after a confirmed manual choice
- **THEN** the view retains the last confirmed language without treating the read failure as an absent setting

#### Scenario: View returns during a save
- **WHEN** a view is hidden after sending a language write, returns before it completes and the response belongs to the previous hidden state
- **THEN** write completion unlocks the switch but is not treated as confirmation of the choice in the view's new state
- **AND** a subsequent successful read applies the mode actually saved; an already sent write is not considered cancelled by hiding the view

### Requirement: Language reconciliation across open views

Open views SHALL reconcile their language with the shared saved setting without requiring closing or reloading. The change SHALL apply on the next successful setting check in the existing refresh cycle; a view that becomes visible or focused again SHALL reread the setting. Reconciliation MUST NOT depend on a successful progress read. Immediate updates to all views are not guaranteed.

#### Scenario: Change from another view
- **WHEN** the page successfully saves Russian while the side panel and Work Status are open in the same device storage scope
- **THEN** they switch to Russian after the next successful setting reread without resetting selected plans

#### Scenario: Progress service unavailable
- **WHEN** the progress service is unavailable but setting storage works
- **THEN** the user can save a language in the panel or page and other views can read and apply that choice

#### Scenario: Late read and concurrent changes
- **WHEN** a response to a read started before a local choice arrives after the new language is successfully saved
- **THEN** that response does not undo the new local choice
- **AND** when multiple views make changes, they reconcile to the final saved value after a successful reread, without a promise of ordering by click time

### Requirement: Complete translation of extension-owned interface text

For English, Russian and Simplified Chinese, the extension SHALL translate its own visible labels, states, warnings, confirmations, hints, errors and action-result messages, as well as accessible names and announcements for assistive technology. The meaning of recorded-progress terminology SHALL be preserved: task readiness is not permission to start, and observed session work does not prove task completion.

#### Scenario: Simplified Chinese interface in all views
- **WHEN** Simplified Chinese is effective and the user views tasks, the map, search, history, a document, setup or diagnostics
- **THEN** extension-owned labels, explanations and messages are displayed in Simplified Chinese, including accessible names and announcements
- **AND** the Chinese wording preserves the distinctions between reported work, readiness, observed activity and blocked tasks

#### Scenario: Russian interface in all views
- **WHEN** Russian is effective and the user views tasks, the map, search, history, a document, setup or diagnostics
- **THEN** extension-owned labels, explanations and messages are displayed in Russian, including accessible names and announcements
- **AND** fixed product names, machine notation and user text are not considered untranslated interface messages

#### Scenario: Help and new map states
- **WHEN** Russian is effective and the user reads map help, selected-task details and explanations of working or blocked dependencies
- **THEN** owned labels, explanations, the detail-close control and the deselection announcement are displayed in Russian
- **AND** translation preserves the distinction between reported work, readiness and observed activity and does not change arrow motion or static-display rules

#### Scenario: Incomplete sub-agent coverage and recording gaps
- **WHEN** Russian is effective and incomplete sub-agent coverage, a recording gap's date or unknown date, or the result of an explicit warning dismissal is shown
- **THEN** the indicator, explanation, accessible action name and safe success, error or conflict messages use Russian
- **AND** translation does not make coverage complete, change the service's assessment of whether the warning needs attention or add a dismissal action to Work Status

#### Scenario: Language change for a retained warning dismissal result
- **WHEN** an accessible announcement already shows a warning dismissal result in English and the language changes to Russian without a new action
- **THEN** the retained announcement text matches Russian and is not replaced by a late English update
- **AND** the language change does not repeat warning dismissal; an ordinary repaint of the same result in the same language does not create a repeated announcement

### Requirement: Localized formatting of displayed values

Dates, relative times, durations, numbers and plural forms displayed in the interface SHALL match the extension's effective language. A manual choice SHALL affect them independently of the OpenChamber language. Formatting MUST NOT change source values, task-count calculations or the meaning of unknown time. Absolute UTC timestamps in exported summaries SHALL retain the existing format.

#### Scenario: Russian durations and plural forms
- **WHEN** Russian is effective and the interface shows durations and quantities 1, 2, 5, 11 and 21
- **THEN** units and word forms match Russian, including the short "только что" and unknown-time states
- **AND** the quantities themselves and source timestamps do not change

#### Scenario: Large quantities on the map
- **WHEN** the same map shows 1000 tasks in English and Russian
- **THEN** English quantities retain the previous `1000`, while Russian statistics, filter labels and announcements use `1 000` with a non-breaking space
- **AND** numeric facts, machine count attributes, identifiers and revision numbers remain unchanged, without localized grouping

#### Scenario: Revision numbers in History and Details
- **WHEN** History or Details is open in Russian for a plan with revision number `1000` and structural revision `11000`
- **THEN** the corresponding numbers are displayed as `1000` and `11000`, without digit-group separators
- **AND** this exception for numbers does not disable localized formatting of task counts and other actual quantities

### Requirement: Original text and machine contracts remain unchanged

Switching language MUST NOT translate, correct or write back the titles and contents of plans, tasks and documents, blocker reasons, next actions, session names or other user values. Machine keys, codes, identifiers, routes and the diagnostic support payload SHALL be preserved. Display and export SHALL preserve the existing safe text representation and data escaping.

#### Scenario: Mixed languages and text containing markup
- **WHEN** an English task title, a Russian blocker reason and a document with HTML-like text are displayed during a language change
- **THEN** their contents are preserved without automatic translation or markup execution
- **AND** only the extension-owned labels around those values are translated

#### Scenario: Session found only in search results
- **WHEN** search with session A selected offers session B found only in results and the user selects B
- **THEN** the selected-session label belongs to B and does not inherit A's retained name
- **AND** B's recorded name remains literal while B's generated label follows the interface language; a retained name may be reused only for the same session identifier

#### Scenario: Generated and recorded names
- **WHEN** the language changes during a workspace refresh or after a previously selected option disappears
- **THEN** generated session and main checkout names follow the selected language
- **AND** known recorded session and checkout names remain literal and are not replaced by generated text solely because they are temporarily unavailable

#### Scenario: Copying the diagnostic payload
- **WHEN** the user copies the support payload in English and Russian for the same observations
- **THEN** the payload's machine fields, allowed values and data composition match regardless of the controls' language

### Requirement: Summaries are generated in the selected language

Progress update, handoff and historical summary-only previews/exports SHALL use the effective language for headings, state names, warnings and explanations. Export SHALL preserve Markdown structure, the order of sections and recorded items, completeness rules, disclosure limits and original user values. Existing English preview/export formatting SHALL remain unchanged for identical inputs. Recorded user text SHALL never be translated.

#### Scenario: Russian summary
- **WHEN** the user opens a progress update or handoff while Russian is effective
- **THEN** the summary's utility text is in Russian, while task titles, identifiers, quantities and the UTC timestamp match the same verified snapshot
- **AND** information excluded from the English summary by privacy and completeness rules does not appear in the Russian one

#### Scenario: Historical summary
- **WHEN** the user explicitly selects the summary-only variant after a full-read failure while Russian is effective
- **THEN** the Russian summary preserves its historical marking, limited completeness and safe failure-category description
- **AND** it does not present partially read tasks as a complete list

### Requirement: Composer insertions and plan mentions follow their own language rules

Session-menu composer insertions SHALL use the effective language with their explicit bounded composer presentation. Service-resolved plan mentions SHALL use English utility text because the host mention request supplies no device-language context; they MUST NOT share a server-side last-used language between clients. Recorded user text SHALL never be translated.

#### Scenario: Localized session action
- **WHEN** a session-menu insertion reads a valid Russian device preference
- **THEN** its summary and extension-owned feedback use Russian without translating recorded titles or changing plan facts
- **AND** no language preference is written and no refresh loop is started

#### Scenario: Mention service has no language context
- **WHEN** either an English or Russian client searches for or resolves a plan mention
- **THEN** service-generated utility text is English and the same report produces the same summary
- **AND** another client's preference does not change the response or existing localized previews

### Requirement: Changing the language of an open preview preserves copy accuracy

When the effective language changes, an open preview SHALL regenerate utility text from the same permitted snapshot without an additional progress read solely for translation. Copy SHALL copy exactly the displayed text. A text change SHALL reset the previous selection and copy confirmation; late completion of an old copy MUST NOT confirm the new preview. Language alone MUST NOT change snapshot completeness.

#### Scenario: Translating an already open summary
- **WHEN** an English summary is open and the effective language changes to Russian without a data snapshot change
- **THEN** the preview shows the Russian version of the same snapshot without creating an additional progress read
- **AND** a subsequent Copy copies the displayed Russian version, while the previous selection and copy confirmation are not carried over

#### Scenario: Copy started before the language change
- **WHEN** copying an English preview has already started and the preview changes to Russian before it completes
- **THEN** the operation preserves the previously authorized English text and does not replace it with Russian
- **AND** its late completion does not show copy confirmation for the Russian preview or start a new copy

### Requirement: Language changes preserve reading state and accessibility

A language change SHALL preserve the selected plan, tab, filters, search text, task disclosures and map position. It MUST NOT change progress, acknowledge history as reviewed or reread a document solely for translation. The switch SHALL work with the keyboard with visible focus; an external choice MUST NOT steal focus. The view document's language SHALL match the effective interface language.

#### Scenario: Switching while reading
- **WHEN** the user changes language with a selected plan, active filters, entered search text and expanded tasks
- **THEN** the reading context is preserved and the action does not report progress, mark history as reviewed or start a document read

#### Scenario: Translating expanded additional details
- **WHEN** the language changes with map help open, a task selected or incomplete sub-agent coverage details expanded
- **THEN** disclosures and reading context are preserved, and language alone does not start new progress, graph or run-record reads, history recovery or warning dismissal
- **AND** explicit user actions and ordinary data refreshes continue to perform their operations; translation does not replace them

#### Scenario: External update while another view has focus
- **WHEN** the saved language changes externally while focus is in another view
- **THEN** current reading disclosures are preserved without stealing focus
- **AND** restoring an open document with a retained error does not become a retry of its read

#### Scenario: Keyboard and external update
- **WHEN** the user selects a language with the keyboard or the language changes from another view
- **THEN** a local choice keeps focus on the switch and an external update does not move focus from the current element
- **AND** accessible names and the document language match the displayed translation, without translated controls causing horizontal overflow in a narrow panel

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
