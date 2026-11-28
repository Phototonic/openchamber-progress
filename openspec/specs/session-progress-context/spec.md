# session-progress-context Specification

## Purpose
Let users open progress for an explicitly chosen session through the host's session action, see bounded session context, and return to the current session without confusing host metadata with reporting authority.

## Requirements

### Requirement: Public native session entry

The extension SHALL offer **Open Agent Progress** through the supported native session-action contract, opening its existing panel with the explicit clicked-session item. It MUST NOT request conversation payloads, use private APIs, compose/send a message, or guess the target from the visible chat or title. Existing composer actions SHALL retain their background behavior and single background entry.

#### Scenario: Clicked session differs from visible chat
- **WHEN** the user invokes the action on session A while session B is visible
- **THEN** the existing panel opens for verified session A's Progress context
- **AND** no Progress data from B is selected as a substitute and no message/draft is changed

#### Scenario: Malformed or unsupported invocation
- **WHEN** the action item is absent/malformed, the action is unsupported, or required permission is denied
- **THEN** the extension shows an appropriate unavailable/refusal state or the host withholds the action
- **AND** it does not invoke a private fallback or select a different source

### Requirement: Source-qualified session scope and lifetime

Action-scoped reads and selection SHALL require the explicit session, verified service source binding and matching current host session context. The existing context owner SHALL retire stale requests on source/account/runtime changes. Unless explicitly reset locally, the labelled pin SHALL survive unrelated visible-chat changes. A host-supplied cleared action item SHALL restore normal current-session scope; reopening alone MUST NOT be treated as proof that the item was cleared.

#### Scenario: Same session identifier in another source
- **WHEN** the store contains a same-spelled session identifier in another or unverified source
- **THEN** those plans are not selected or enriched as the clicked host session's plans

#### Scenario: Context changes during a read
- **WHEN** the host changes project, worktree, account or runtime while action-scoped data is loading
- **THEN** old responses are retired and the target is revalidated or shown unavailable
- **AND** no result from the old identity is painted as the new context

#### Scenario: Target session is unavailable
- **WHEN** current host coverage cannot establish the clicked session or its matching location
- **THEN** the action-scoped view explains the unavailable or checking state
- **AND** it does not silently broaden to directory-wide plans or another session

### Requirement: Explicit local return to current-session scope

The pinned-scope label SHALL offer a visible, keyboard-accessible localized **Show current session** control, including when the target is unavailable. Reset SHALL retire the pinned reading and use normal host current-session scope without changing host selection or progress. The same retained item replay MUST NOT undo that reset in the current frame. Documentation SHALL explain the retained-item limitation in [OpenChamber issue #6938](https://github.com/openchamber/openchamber/issues/6938).

#### Scenario: Ordinary reopening retains the host action item
- **WHEN** the user opens session A's Progress, closes the panel and reopens it from the toolbar while B is current, and the host still supplies A's item
- **THEN** the panel honestly labels A as the pinned scope and offers the reset control
- **AND** it does not infer an ordinary opening from visibility, elapsed time or a host-version check

#### Scenario: User explicitly returns to the current session
- **WHEN** the user activates the reset control while A is pinned and B is the host's current session
- **THEN** old pinned responses are retired and the panel shows B through the ordinary scope/selection rules
- **AND** no host navigation, task mutation or draft change occurs; repeated delivery of A's retained item does not re-pin the same frame
- **AND** another click on A's action with identical item data remains indistinguishable from replay, even after close/reopen; a different session's action or a host reload is needed before A can pin again, as documented in issue #6938

#### Scenario: Current session is absent or the pin is unavailable
- **WHEN** the user resets an unavailable pinned target and the host has no current session
- **THEN** the panel shows its ordinary no-session state without selecting a substitute
- **AND** resetting does not require a successful read of the pinned target

#### Scenario: Host clears or changes the action item
- **WHEN** the host supplies no action item or a different valid action target
- **THEN** the existing context owner respectively returns to ordinary scope or validates the new target
- **AND** a cleared item needs no manual reset or version-specific workaround

#### Scenario: Reset with keyboard or Russian interface
- **WHEN** the user activates the localized reset control by keyboard, including with Russian selected
- **THEN** the control is operable with visible focus and its removal leaves focus on the resulting scope heading or state through the existing focus handoff
- **AND** ordinary refreshes do not steal focus or undo the selected scope

### Requirement: Explicit empty and multiple-plan handling

The action SHALL reuse existing panel plan selection within the validated source/session result, including a valid saved choice and the normal automatic selection rule. Multiple plans SHALL remain individually selectable and visibly scoped, with the picker stating the shown plan's position among them. Failed or incomplete reads SHALL NOT be presented as an authoritative empty or complete result.

#### Scenario: Multiple reported plans
- **WHEN** the target has several eligible plans
- **THEN** the existing picker exposes them and states the shown plan's position, without a separate chosen-or-automatic note
- **AND** no combined synthetic plan or cross-source fallback is created

#### Scenario: No plans or incomplete read
- **WHEN** a complete validated result is empty
- **THEN** the panel explains that the session has no plan yet
- **AND** a failed read instead explains itself, and a capped read marks its counts as possibly incomplete, rather than claiming no plans

### Requirement: Optional source-labelled host work context

Session details MAY show validated host agent and linked-resource metadata. All such context SHALL be bounded, literal and labelled as host-supplied. It MUST NOT determine plan identity, assignment, progress, acceptance, completion or workflow selection. Missing or malformed data SHALL NOT invalidate the session. The guest MUST NOT fetch linked resources, execute their content or change host or plan data.

#### Scenario: Metadata is present
- **WHEN** verified matching session metadata contains an agent and linked issues or changes
- **THEN** expanded Sessions retains its bounded, literal host-reported agent and link titles for each matched participant, distinct from reported task facts

#### Scenario: Metadata is missing or hostile
- **WHEN** optional metadata is absent, malformed, oversized or contains markup-like text
- **THEN** absent or unusable links leave no placeholder, invalid fields are dropped or inert, and admitted labels appear as bounded literal text, never rendered markup
- **AND** neither a new destination, an assignment nor an automatic fetch results; the plan remains readable

### Requirement: Supported affordances and compatible interaction

The host floor and permissions SHALL remain unchanged. Workflows navigation/control SHALL be omitted while the pinned public API lacks a verified destination/availability contract; guessed surfaces MUST NOT be used. New extension-owned context/error text SHALL follow the existing localization, keyboard, focus and theme behavior. Expanded Sessions SHALL have one section heading, without a duplicate inside the participant list.

#### Scenario: Workflows is disabled or unsupported
- **WHEN** the host has no verified public Workflows navigation/availability contract, including the pinned SDK
- **THEN** no Workflows shortcut or workflow request is offered
- **AND** the view never claims that a particular run was selected

#### Scenario: Keyboard and theme
- **WHEN** the user invokes the native action and navigates the panel with the keyboard, changes language, or uses dark/light or reduced-motion settings
- **THEN** the existing readable, focus-visible interaction remains intact and source/plan selection is preserved through ordinary repaints

#### Scenario: Expanded Sessions heading
- **WHEN** the user opens the expanded Sessions panel in English or Russian
- **THEN** one section heading labels the participant list
- **AND** participant facts, optional host metadata and the close/focus behavior remain unchanged

#### Scenario: Older host or withdrawn approval
- **WHEN** installation is attempted below the declared host floor or approval is withdrawn on a supporting host
- **THEN** the existing host-version/permission refusal applies without new permissions or fallback navigation
- **AND** unsupported or untested configurations are recorded honestly rather than certified

### Requirement: Main-session links beside the selected plan

The board and rail SHALL show the selected plan’s verified main-session links as compact, host-labelled, read-only header chips. They MUST NOT infer numbers or resource state. Only explicit activation of a validated address may invoke the supported host opener. Discovering and presenting links SHALL use existing session snapshots, without a new permission or network call.

#### Scenario: A linked issue and change
- **WHEN** the selected plan’s verified main session supplies an issue and a change with web addresses
- **THEN** its board and rail header show their literal titles without changing the report or implying the change shipped
- **AND** when the snapshot contains no usable links, neither surface shows a chip group, placeholder or notice

#### Scenario: The visible chat is not the owner
- **WHEN** a board selection or a rail plan reached through a contributing session belongs to a different main session than the current chat
- **THEN** only the selected plan’s verified main-session links can appear in the header, never a union of participant or visible-chat links
- **AND** without an unambiguous current match in the verified source there are no header chips, even for a same-spelled session identifier

#### Scenario: The host changes the links or the reading changes
- **WHEN** a current session snapshot replaces or removes a link without a new report, or the reader switches to a plan, source or account without matching links
- **THEN** the header reflects the new context and no previous chip remains actionable for it

#### Scenario: The reader opens a linked resource
- **WHEN** the reader explicitly activates an admitted chip by pointer or keyboard
- **THEN** the guest asks only OpenChamber’s supported opener to open that validated HTTP(S) address, once for that activation
- **AND** a refusal leaves the plan intact, gives localized feedback and never falls back to direct navigation or a network request

#### Scenario: Links in a narrow rail
- **WHEN** there are several links or a long title on a narrow rail
- **THEN** the source label, controls and plan actions remain legible and keyboard-accessible in the existing host theme, without whole-frame horizontal scrolling or a new card, banner or multi-line notice
- **AND** if more links are known than represented, the compact qualification does not claim an exact total
