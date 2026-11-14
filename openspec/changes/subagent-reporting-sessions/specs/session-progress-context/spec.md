## ADDED Requirements

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

Action-scoped reads and selection SHALL require the explicit session, verified service source binding and matching current host session context. The existing context owner SHALL retire stale requests on source/account/runtime changes. Unrelated visible-chat changes MUST NOT override a still-current action item. An explicit ordinary opening without an action item SHALL retain the established normal panel behavior.

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

### Requirement: Explicit empty and multiple-plan handling

The action SHALL reuse existing panel plan selection within the validated source/session result, including a valid saved choice and the normal automatic selection rule. Multiple plans SHALL remain individually selectable and visibly scoped. Failed or incomplete reads SHALL NOT be presented as an authoritative empty or complete result.

#### Scenario: Multiple reported plans
- **WHEN** the target has several eligible plans
- **THEN** the existing picker exposes them with the chosen/automatic indication
- **AND** no combined synthetic plan or cross-source fallback is created

#### Scenario: No plans or incomplete read
- **WHEN** a complete validated result is empty
- **THEN** the panel explains that no plan is reported for that session
- **AND** a failed or capped read instead explains its limitation rather than claiming no plans

### Requirement: Optional source-labelled host work context

The existing live-session adapter MAY expose validated optional host agent and linked-resource metadata in existing session details. Displayed information SHALL be bounded, literal and explicitly labelled as host context. Missing or malformed optional fields SHALL NOT establish failure of an otherwise valid session. This metadata MUST NOT establish task assignment, progress, acceptance or workflow-run selection, and MUST NOT cause URL fetching or new execution controls.

#### Scenario: Metadata is present
- **WHEN** verified matching current-host session metadata contains an agent and linked issues or changes
- **THEN** the view may show their bounded literal labels as host-supplied context
- **AND** task facts and reported counts remain unchanged

#### Scenario: Metadata is missing or hostile
- **WHEN** optional values are absent, malformed, oversized or contain markup-like text
- **THEN** missing/invalid values are omitted or safely bounded and valid text renders literally
- **AND** no assignment, URL fetch or fabricated linked resource results

### Requirement: Supported affordances and compatible interaction

The change SHALL retain the declared host floor and existing permissions. It SHALL omit a Workflows shortcut while the pinned public API lacks a verified destination and availability contract; guessed surface identifiers and workflow control SHALL NOT be used. New extension-owned context/error text SHALL follow existing English/Russian localization, keyboard, focus and theme behavior.

#### Scenario: Workflows is disabled or unsupported
- **WHEN** the host has no verified public Workflows navigation/availability contract, including the pinned SDK
- **THEN** no Workflows shortcut or workflow request is offered
- **AND** the view never claims that a particular run was selected

#### Scenario: Keyboard and theme
- **WHEN** the user invokes the native action and navigates the panel with the keyboard, changes language, or uses dark/light or reduced-motion settings
- **THEN** the existing readable, focus-visible interaction remains intact and source/plan selection is preserved through ordinary repaints

#### Scenario: Older host or withdrawn approval
- **WHEN** installation is attempted below the declared host floor or approval is withdrawn on a supporting host
- **THEN** the existing host-version/permission refusal applies without new permissions or fallback navigation
- **AND** unsupported or untested configurations are recorded honestly rather than certified
