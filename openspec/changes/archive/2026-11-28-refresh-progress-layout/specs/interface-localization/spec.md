## MODIFIED Requirements

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

### Requirement: Behavior without device storage support

Without device storage the extension SHALL follow the host language. The Language entry SHALL remain in Settings with choices disabled and one accessible explanation. It MUST NOT create a temporary manual choice, make unsupported device requests or fall back to shared server storage.

#### Scenario: Host does not advertise support
- **WHEN** the host lacks device storage
- **THEN** all three surfaces use automatic mode, and both Settings menus explain the disabled choices without requesting or saving them
