## ADDED Requirements

### Requirement: Phone entry surfaces and explicit acceptance limits

Panel and page mobile contributions SHALL expose the rail and board on supported authenticated host routes for 1.4.0 by owner decision. Physical-phone acceptance SHALL run on the live release, with a hotfix if needed. This replaces the pre-release physical-phone gate. Browser emulation MUST NOT be described as physical-device acceptance. Existing Work Status, tool rows, mentions, sidebar marks and background actions SHALL be checked and documented separately from opted-in surfaces.

#### Scenario: Phone user opens progress
- **WHEN** the opted-in panel is opened through the phone workspace, plus menu, Work Status or supported session action
- **THEN** a discoverable readable progress view opens without a surface-unavailable error
- **AND** the opted-in page is available through More with the host's full-screen back navigation

#### Scenario: Physical acceptance follows release
- **WHEN** the owner ships the mobile-enabled rail and board for 1.4.0 with only desktop narrow-width or touch-emulation evidence
- **THEN** that evidence remains supporting evidence, not physical-phone acceptance
- **AND** documentation identifies physical-phone acceptance as pending on the live release, with a hotfix if needed for a failed configuration
- **AND** a later physical-device failure is recorded honestly and the affected mobile contribution can be withdrawn through a matched manifest/distribution update

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
