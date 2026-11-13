# Spec Delta

## MODIFIED Requirements

### Requirement: Summaries are generated in the selected language

Progress update, handoff and historical summary-only previews/exports SHALL use the effective language for headings, state names, warnings and explanations. Export SHALL preserve Markdown structure, the order of sections and recorded items, completeness rules, disclosure limits and original user values. Existing English preview/export formatting SHALL remain unchanged for identical inputs. Session-menu composer insertions SHALL use the same effective language with their explicit bounded composer presentation. Service-resolved plan mentions SHALL use English utility text because the host mention request supplies no device-language context; they MUST NOT share a server-side last-used language between clients. Recorded user text SHALL never be translated.

#### Scenario: Russian summary
- **WHEN** the user opens a progress update or handoff while Russian is effective
- **THEN** the summary's utility text is in Russian, while task titles, identifiers, quantities and the UTC timestamp match the same verified snapshot
- **AND** information excluded from the English summary by privacy and completeness rules does not appear in the Russian one

#### Scenario: Historical summary
- **WHEN** the user explicitly selects the summary-only variant after a full-read failure while Russian is effective
- **THEN** the Russian summary preserves its historical marking, limited completeness and safe failure-category description
- **AND** it does not present partially read tasks as a complete list

#### Scenario: Localized session action
- **WHEN** a session-menu insertion reads a valid Russian device preference
- **THEN** its summary and extension-owned feedback use Russian without translating recorded titles or changing plan facts
- **AND** no language preference is written and no refresh loop is started

#### Scenario: Mention service has no language context
- **WHEN** either an English or Russian client searches for or resolves a plan mention
- **THEN** service-generated utility text is English and the same report produces the same summary
- **AND** another client's preference does not change the response or existing localized previews
