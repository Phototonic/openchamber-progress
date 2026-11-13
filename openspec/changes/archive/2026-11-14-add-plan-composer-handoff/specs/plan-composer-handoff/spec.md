# Spec Delta

## Purpose

Let users explicitly carry reported progress into a composer chip or editable draft without sending, changing progress or granting reporting authority.

## ADDED Requirements

### Requirement: One deterministic reported-progress summary

Both composer entry points and existing previews SHALL use one pure summary builder and shared readiness decisions. Composer text SHALL include the source-qualified key, revision and absolute UTC **Reported as of** time, distinguish reported progress from verified completion, and ask for review before sending. Counts SHALL retain whole-plan semantics; suggestions SHALL depend only on complete recorded prerequisites.

#### Scenario: Same observed report
- **WHEN** the builder receives the same complete snapshot, format, language and composer presentation context
- **THEN** it returns the same text regardless of current time, browser state or live session activity
- **AND** mention resolution and a handoff insertion without additional session-selection context agree for the same inputs
- **AND** counts remain server-authoritative, with groups excluded and skipped tasks distinct from done

#### Scenario: No inferred completion or permission
- **WHEN** a plan is closed, readiness is invalid or prerequisites are incomplete
- **THEN** the summary preserves reported facts without inventing readiness, approval, permission to start or verified completion

### Requirement: Bounded text without partial task rows

Composer text SHALL contain at most 16,000 JavaScript string code units, including qualifications and omission notices. The builder SHALL preserve identity and safety text, retain deterministic section/task order, and omit whole task rows instead of slicing text. It SHALL count eligible task rows withheld by row or character limits and state how many tasks were omitted from those sections.

#### Scenario: Large plan with long prerequisites
- **WHEN** a complete plan's formatted work sections exceed the ceiling
- **THEN** the output stays within the ceiling, includes **N tasks omitted** with the correct eligible-row count, and contains no partially truncated row
- **AND** report counts and identity still describe the whole observed plan

#### Scenario: Short menu title
- **WHEN** a menu title is shortened to fit the host's display limit
- **THEN** shortening is visibly marked and does not change the source-qualified identity or the full title used by summary generation

### Requirement: Complete matching detail

Successful composer summaries SHALL use complete matching item and contribution detail from one accepted store/binding/key/revision/cleanup identity. Failed, capped or mixed reads MUST NOT become partial successful summaries.

#### Scenario: Failure during continuation
- **WHEN** detail continuation fails, changes identity or exhausts its restart/page/deadline budget
- **THEN** mention resolution fails or the action explains that complete progress could not be read
- **AND** no chip or draft insertion is manufactured from a list row or partial tasks

### Requirement: Limited disclosure of recorded data

Composer text MUST NOT include captured document text, transcripts, tool output, raw diagnostics, blocker details or machine-path metadata. Recorded literals SHALL remain escaped data with review wording, without claiming redaction or prompt-injection prevention. The source-qualified key SHALL be a composer-only addition to legacy preview identifier disclosure.

#### Scenario: Untrusted recorded title
- **WHEN** a recorded title contains Markdown, HTML-looking text, multiple lines or instructions
- **THEN** it remains literal reported data and neither triggers markup execution nor expands permissions or omitted content

### Requirement: Search for plans in the mention menu

The extension SHALL contribute an **Agent progress** mention section. Authenticated `POST /mentions/search` with `{query,directory}` SHALL return at most 20 distinct rows identified by `${sourceId}/${id}`. Search SHALL match plan titles/IDs using bounded reads without per-row complete-detail, history, document or timing requests. Incomplete coverage SHALL be qualified, not presented as a complete census.

#### Scenario: Rapid queries on a representative store
- **WHEN** rapid and concurrent typing queries search a synthetic store of approximately 450 plans and 1,700 tasks
- **THEN** results remain request-local and within row/work bounds, with measured normal latency comfortably below the host's two-second search budget
- **AND** a slow or failed service contributes no rows and does not block the host's file suggestions

### Requirement: Relevant ranked rows with source qualifications

Discovered candidates SHALL rank by current directory, unambiguously established recorded project, then other locations. Within each locality, active plans SHALL precede closed plans, followed by report recency and stable key tie-breaking. Subtitles SHALL show reported progress/lifecycle and the board's other-source/unverified qualifications.

#### Scenario: Duplicate titles and different locations
- **WHEN** matching active and closed plans exist in the current location and elsewhere, including equal titles in different sources
- **THEN** rows follow the locality/lifecycle ordering, remain distinct by source-qualified ID and retain source warnings
- **AND** ambiguous project metadata falls back to directory ranking without inferring membership from similar path prefixes

### Requirement: Resolve the selected source-qualified plan

Authenticated `POST /mentions/resolve` with `{id}` SHALL return `{text}` built from complete current matching detail for that key. Missing, deleted or archived plans SHALL return 404. Resolution SHALL remain read-only and SHALL NOT silently resolve a same-title plan or another source. The host-selected chip SHALL retain the returned as-of summary; later reports do not turn that snapshot into verified or live progress.

#### Scenario: Removed after search
- **WHEN** the selected plan is deleted or archived before resolution
- **THEN** the route returns 404 and the host reports failure without adding an empty or misleading chip

#### Scenario: Successful chip
- **WHEN** the user types `@` and chooses a valid plan on a supporting isolated host
- **THEN** a chip carries the resolved bounded summary, and no message is sent by the extension

### Requirement: Session-menu selection respects the clicked session

**Insert handoff** and **Insert progress update** SHALL be background session actions without message payload permission. Lookup SHALL use the clicked session's ID and scoped read semantics, constrained to the verified bound source. A valid saved rail choice SHALL precede automatic featured-plan selection. Other plans SHALL be counted but never merged. Incomplete lists or unavailable choice reads MUST NOT silently establish a different choice or exact count.

#### Scenario: Saved choice and several plans
- **WHEN** the clicked session has multiple eligible plans and its saved rail choice remains visible in that complete scoped result
- **THEN** either action inserts that plan even if another has a newer report or is active
- **AND** the text identifies the chosen plan and counts the other plans excluded
- **AND** neither the visible chat's session nor a matching title supplies lookup identity

#### Scenario: Missing or stale choice
- **WHEN** there is no saved choice, or it no longer belongs to the eligible scoped result
- **THEN** the latest active plan with reported working tasks is featured, otherwise the existing owned-first scoped ordering supplies the fallback

#### Scenario: No plan or unavailable data
- **WHEN** a successful complete scoped read contains no eligible plan
- **THEN** the action toasts **No plan reported for this session** and inserts nothing
- **AND** unavailable service, denied permission, unverified binding and incomplete reads instead receive distinct plain failure feedback, not that empty-state claim

### Requirement: Append for review to the active chat

An action SHALL append its bounded text through `host.compose` to the active chat's draft, preserving existing draft content. The clicked session is the source, not a promised destination: the active chat may be another/new session or may change while the summary is prepared. The extension SHALL explain this destination and review requirement, MUST NOT navigate or open a panel, and MUST NOT send, auto-retry an uncertain insertion or mutate progress.

#### Scenario: Different source and destination with an existing draft
- **WHEN** the user opens one session's menu while another chat has draft text and selects an insertion action
- **THEN** the clicked session supplies the selected report and the active draft retains its original text with the summary appended
- **AND** plain feedback says it was added to the active chat for review, with no send

#### Scenario: Switch while preparing
- **WHEN** the active chat changes before the host consumes the compose request
- **THEN** the host may append to that new active chat, never changing which session's plan was read
- **AND** documentation and feedback do not claim target-session-only delivery

### Requirement: Ephemeral and read-only execution

The background guest SHALL load on demand, await its action work and finish without polling or persistent background state. Both features SHALL retain existing service authentication, fixed safe errors and store/source validation. They MUST NOT change statuses, approvals, assignments, receipts, capture, cleanup or stored documents, and MUST NOT add transcript/message permissions, notifications, automatic sending or a second resume mechanism.

#### Scenario: Permission withdrawal or retirement
- **WHEN** the host disables the extension, withdraws approval, changes runtime or retires an invocation during pending reads
- **THEN** retired work cannot start a later compose operation or claim success
- **AND** already delivered draft/chip text is not claimed to have been retracted

### Requirement: Additive compatibility and installable output

The service SHALL retain protocol/schema 2 and advertise `planComposerHandoff:1`. Consumers SHALL not treat missing capability as empty progress. Release 1.2.0 SHALL declare `engines.openchamber: ">=2.7.1"` and retain SDK pin 2.7.0. Installation SHALL succeed on 2.7.1 and fail below it with the host's normal version message. Distribution SHALL include built background and affected regenerated outputs in parity/package checks, without migrations or new runtime dependencies.

#### Scenario: Host below the release floor
- **WHEN** installation of the candidate is attempted on a host below 2.7.1
- **THEN** the host refuses installation with its normal version message rather than installing with omitted contributions

#### Scenario: Unsupported service on a supported host
- **WHEN** a background action on a supported host encounters a service without the capability
- **THEN** it gives a plain unavailable result rather than calling unsupported summary behavior

#### Scenario: Packaged background action
- **WHEN** a clean folder or ZIP distribution is installed in an isolated 2.7.1 host
- **THEN** installation succeeds and both session actions load the shipped classic background script without a build or dependency download
- **AND** the action frame ends after execution while the user's draft remains editable and unsent
