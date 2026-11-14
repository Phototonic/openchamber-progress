## ADDED Requirements

### Requirement: Accepted phone entry surfaces

Panel and page mobile contributions SHALL be enabled only after their respective physical-phone acceptance on a supported authenticated host route. Existing Work Status, tool rows, mentions, sidebar marks and background actions SHALL be checked and documented separately from opted-in surfaces.

#### Scenario: Phone user opens progress
- **WHEN** the accepted panel is opened through the phone workspace, plus menu, Work Status or supported session action
- **THEN** a discoverable readable progress view opens without a surface-unavailable error
- **AND** the accepted page is available through More with the host's full-screen back navigation

#### Scenario: Surface has not passed physical acceptance
- **WHEN** only desktop narrow-width or touch-emulation evidence exists, or physical acceptance fails
- **THEN** that evidence remains supporting evidence and the surface is not shipped as mobile-enabled
- **AND** documentation identifies the untested or failed configuration

### Requirement: Usable phone layout and interaction

Phone panel/page layouts SHALL provide readable task, board, map and plan controls around 390 CSS pixels, with coarse-pointer targets, safe-area/keyboard accommodation and non-hover navigation. Essential actions MUST NOT depend solely on long-press. Optional device metadata SHALL affect presentation only.

#### Scenario: Touch navigation and device changes
- **WHEN** the user selects plans/tasks, inspects dependencies, opens/closes sheets and rotates or opens the keyboard
- **THEN** content and essential controls remain reachable with meaningful focus/selection
- **AND** list access and labelled tap actions remain available without hover or long-press

#### Scenario: Device metadata absent
- **WHEN** the host omits optional device metadata
- **THEN** responsive layout and existing desktop/keyboard behavior remain usable without a fabricated phone identity

### Requirement: Preserved phone context and security

Phone reads SHALL retain the existing source/account/runtime/session retirement and action-pin rules. Reconnect or host/session switches MUST NOT paint retired context as current. No mobile feature SHALL weaken authentication, permission or reporting authority boundaries.

#### Scenario: Switch during delayed read
- **WHEN** the host or verified source changes while a phone read is outstanding
- **THEN** the old reply is discarded and the new context is verified or shown unavailable

#### Scenario: Retained session action after reset
- **WHEN** the host replays the same session item after Show current session
- **THEN** the existing frame-local reset contract remains in force
- **AND** the actual phone limitation and tested versions are documented without a visibility-based workaround
